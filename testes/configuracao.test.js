'use strict';

/**
 * Módulo de configuração, de ponta a ponta, contra a API e o banco de verdade.
 *
 * O que interessa aqui é o comportamento observável: o que a rota pública
 * entrega a um visitante, o que um usuário comum consegue alterar (nada), e se
 * o valor novo vale imediatamente para quem consome pela API interna.
 *
 *   node testes/configuracao.test.js
 *
 * Nota: enquanto `src/routes/index.js` não registrar a linha
 * `router.use('/v1/configuracoes', require('../features/configuracao/configuracao.routes'))`
 * — arquivo que este módulo não pode editar —, a suíte monta a mesma pilha de
 * middlewares do `app.js` num servidor próprio. Quando a linha existir, ela usa
 * o app real automaticamente.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const { limparLimites, encerrarInfra } = require('./apoio');
const appReal = require(RAIZ + '/app');
const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');
const configuracao = require(RAIZ + '/src/features/configuracao');
const registroService = require(RAIZ + '/src/features/auth/auth.registro.service');

let server, base, autenticado;

const req = async (metodo, caminho, corpo, token) => {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

let falhas = 0;
const ok = (nome, cond, extra) => {
  if (!cond) falhas += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

/** cria conta e devolve o token; `admin` acrescenta o papel de administrador */
async function conta({ admin } = {}) {
  const email = `cfg${Date.now()}${Math.floor(Math.random() * 1000)}@agropecas.dev`;
  const ctx = { ipHash: 'c'.repeat(64), userAgent: 'teste', origem: 'web' };

  const { usuario } = await registroService.criar(
    {
      nome: 'teste configuracao',
      email,
      senha: 'SenhaForte123',
      tipoPerfil: 'produtor',
      consentimentos: [
        { tipo: 'termos_de_uso', aceito: true },
        { tipo: 'politica_privacidade', aceito: true },
      ],
    },
    ctx
  );

  if (admin) {
    const papel = await db.Papel.findOne({ where: { chave: 'admin' } });
    await db.UsuarioPapel.findOrCreate({
      where: { usuario_id: usuario.id, papel_id: papel.id },
      defaults: { usuario_id: usuario.id, papel_id: papel.id },
    });
  }

  /* login depois de atribuir o papel: as permissões vão no contexto da sessão */
  const loginService = require(RAIZ + '/src/features/auth/auth.login.service');
  const { tokens } = await loginService.entrar({ email, senha: 'SenhaForte123' }, ctx);
  return { usuarioId: usuario.id, token: tokens.acesso };
}

/** monta o servidor: app real se a feature já estiver registrada, senão a mesma pilha */
async function subirServidor() {
  const provisorio = appReal.listen(0);
  const porta = provisorio.address().port;
  const r = await fetch(`http://127.0.0.1:${porta}/api/v1/configuracoes/publicas`);
  provisorio.close();

  if (r.status !== 404) {
    server = appReal.listen(0);
    console.log('  --  usando o app real (rota já registrada em src/routes/index.js)');
  } else {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use(middlewares.contexto);
    app.use('/api/v1/configuracoes', require(RAIZ + '/src/features/configuracao/configuracao.routes'));
    app.use(middlewares.erro);
    server = app.listen(0);
    console.log('  --  rota ainda não registrada em src/routes/index.js: usando pilha equivalente');
  }

  base = 'http://127.0.0.1:' + server.address().port + '/api/v1/configuracoes';
}

(async () => {
  await limparLimites();
  await subirServidor();

  const admin = await conta({ admin: true });
  const comum = await conta();

  console.log('\n— rota pública —');
  let r = await req('GET', '/publicas');
  ok('visitante lê as públicas → 200', r.status === 200, r.corpo);
  ok('entrega o WhatsApp de suporte', !!r.corpo?.dados?.['contato.whatsapp_suporte'], r.corpo?.dados);
  ok('entrega max_fotos já como número', typeof r.corpo?.dados?.['anuncio.max_fotos'] === 'number', r.corpo?.dados);
  ok('entrega chat.ativo já como booleano', typeof r.corpo?.dados?.['chat.ativo'] === 'boolean', r.corpo?.dados);

  const publicado = JSON.stringify(r.corpo?.dados || {});
  const sensiveis = [
    'anuncio.moderacao_previa',
    'anuncio.dias_validade',
    'anuncio.max_ativos_por_usuario',
    'chat.admin_le_somente_com_denuncia',
    'localizacao.produtor_aproximada',
  ];
  sensiveis.forEach((chave) => ok(`não vaza "${chave}"`, !publicado.includes(chave), publicado));

  /* o vetor real: marcar publica=true no banco não pode furar a lista branca */
  await db.Configuracao.update({ publica: true }, { where: { chave: 'anuncio.moderacao_previa' } });
  await configuracao.invalidar();
  r = await req('GET', '/publicas');
  ok(
    'publica=true no banco NÃO fura a lista branca do código',
    !JSON.stringify(r.corpo?.dados || {}).includes('moderacao_previa'),
    r.corpo?.dados
  );
  await db.Configuracao.update({ publica: false }, { where: { chave: 'anuncio.moderacao_previa' } });
  await configuracao.invalidar();

  console.log('\n— leitura autenticada —');
  r = await req('GET', '/');
  ok('sem token → 401', r.status === 401, r.corpo);
  r = await req('GET', '/', null, comum.token);
  ok('usuário comum sem configuracao.ler → 403', r.status === 403, r.corpo);
  r = await req('GET', '/', null, admin.token);
  ok('admin lista todas → 200', r.status === 200 && r.corpo.dados.length >= 9, r.corpo?.dados?.length);
  ok('item traz tipo, grupo e descrição', !!r.corpo?.dados?.[0]?.tipo && !!r.corpo?.dados?.[0]?.grupo, r.corpo?.dados?.[0]);
  ok('não expõe o valor bruto do JSONB', !JSON.stringify(r.corpo.dados).includes('"bruto"'));

  r = await req('GET', '/?grupo=contato', null, admin.token);
  ok('filtra por grupo', r.status === 200 && r.corpo.dados.every((i) => i.grupo === 'contato'), r.corpo?.dados);

  r = await req('GET', '/anuncio.dias_validade', null, admin.token);
  ok('lê uma chave → 200', r.status === 200 && r.corpo.dados.chave === 'anuncio.dias_validade', r.corpo);

  console.log('\n— escrita —');
  r = await req('PUT', '/anuncio.dias_validade', { valor: 45 }, comum.token);
  ok('usuário comum sem configuracao.editar → 403', r.status === 403, r.corpo);

  r = await req('PUT', '/anuncio.dias_validade', { valor: 'sessenta' }, admin.token);
  ok('tipo errado (texto em campo numérico) → 422', r.status === 422, r.corpo);
  r = await req('PUT', '/anuncio.moderacao_previa', { valor: 'talvez' }, admin.token);
  ok('texto em campo booleano → 422', r.status === 422, r.corpo);
  r = await req('PUT', '/contato.email_suporte', { valor: 42 }, admin.token);
  ok('número em campo de texto → 422', r.status === 422, r.corpo);

  r = await req('PUT', '/anuncio.inexistente_xyz', { valor: 1 }, admin.token);
  ok('chave inexistente → 404 (sem criação silenciosa)', r.status === 404, r.corpo);
  const criouLixo = await db.Configuracao.count({ where: { chave: 'anuncio.inexistente_xyz' } });
  ok('nada foi criado no banco', criouLixo === 0, criouLixo);

  console.log('\n— cache invalida na escrita —');
  const antes = await configuracao.numero('anuncio.dias_validade', 60);
  ok('valor inicial vem tipado como número', typeof antes === 'number', antes);

  const novo = antes === 45 ? 50 : 45;
  r = await req('PUT', '/anuncio.dias_validade', { valor: novo, motivo: 'teste automatizado' }, admin.token);
  ok('escrita válida → 200', r.status === 200 && r.corpo.dados.valor === novo, r.corpo);

  /* sem espera: a invalidação é síncrona na escrita, não depende do TTL */
  const depois = await configuracao.numero('anuncio.dias_validade', 60);
  ok('API interna já enxerga o valor novo (cache invalidado)', depois === novo, { antes, depois, novo });

  r = await req('GET', '/publicas');
  ok('rota pública não quebrou com a escrita', r.status === 200, r.corpo);

  console.log('\n— API interna —');
  const padrao = await configuracao.obter('nao.existe.esta.chave', 'valor-padrao');
  ok('obter com chave inexistente devolve o padrão', padrao === 'valor-padrao', padrao);
  ok('e não lança', true);

  const semPadrao = await configuracao.obter('nao.existe.tambem');
  ok('sem padrão informado devolve null, não explode', semPadrao === null, semPadrao);

  const lote = await configuracao.obterVarias({
    dias: ['anuncio.dias_validade', 60],
    fotos: ['anuncio.max_fotos', 8],
    fantasma: ['nao.existe.no.lote', 'ausente'],
  });
  ok('lote devolve tudo de uma vez, com tipos', lote.dias === novo && typeof lote.fotos === 'number', lote);
  ok('lote respeita o padrão da chave ausente', lote.fantasma === 'ausente', lote);
  ok('booleano() devolve booleano', typeof (await configuracao.booleano('chat.ativo', false)) === 'boolean');
  ok('texto() devolve string', typeof (await configuracao.texto('contato.email_suporte', '')) === 'string');

  console.log('\n— auditoria e histórico —');
  const registro = await db.Configuracao.findOne({ where: { chave: 'anuncio.dias_validade' } });
  const trilha = await db.LogAuditoria.findOne({
    where: { entidade: 'configuracoes', entidade_id: registro.id },
    order: [['criado_em', 'DESC']],
  });
  ok('gravou trilha com valor antes e depois', !!trilha && trilha.antes?.valor === antes && trilha.depois?.valor === novo, {
    antes: trilha?.antes,
    depois: trilha?.depois,
  });
  ok('registrou o autor da mudança', trilha?.ator_id === admin.usuarioId, trilha?.ator_id);
  ok('IP só em hash', !trilha?.ip_hash || trilha.ip_hash.length === 64, trilha?.ip_hash);
  ok('quem alterou ficou na configuração', registro.atualizado_por === admin.usuarioId, registro.atualizado_por);

  r = await req('GET', '/anuncio.dias_validade/historico', null, admin.token);
  ok('histórico paginado → 200', r.status === 200 && r.corpo.dados.length >= 1, r.corpo);
  ok('histórico mostra de → para', r.corpo?.dados?.[0]?.para === novo, r.corpo?.dados?.[0]);
  ok('histórico não expõe ip_hash', !JSON.stringify(r.corpo.dados).includes('ip_hash'));
  r = await req('GET', '/anuncio.dias_validade/historico', null, comum.token);
  ok('histórico sem permissão → 403', r.status === 403, r.corpo);

  console.log('\n— escrita em lote —');
  r = await req(
    'PUT',
    '/',
    { itens: [{ chave: 'anuncio.max_fotos', valor: 10 }, { chave: 'contato.email_suporte', valor: 999 }] },
    admin.token
  );
  ok('lote com um tipo errado → 422', r.status === 422, r.corpo);
  const fotosAposFalha = await configuracao.numero('anuncio.max_fotos', 8);
  ok('nenhuma alteração do lote foi aplicada', fotosAposFalha === 8, fotosAposFalha);

  r = await req(
    'PUT',
    '/',
    { itens: [{ chave: 'anuncio.max_fotos', valor: 10 }, { chave: 'chat.ativo', valor: true }] },
    admin.token
  );
  ok('lote válido → 200', r.status === 200, r.corpo);
  ok('lote aplicou o novo valor', (await configuracao.numero('anuncio.max_fotos', 8)) === 10);

  console.log('\n— restaurando os valores do seed —');
  await db.Configuracao.update({ valor: 60 }, { where: { chave: 'anuncio.dias_validade' } });
  await db.Configuracao.update({ valor: 8 }, { where: { chave: 'anuncio.max_fotos' } });
  await configuracao.invalidar();
  ok('valores do seed restaurados', (await configuracao.numero('anuncio.max_fotos', 0)) === 8);

  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
