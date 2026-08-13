'use strict';

/**
 * Mesa de moderação de ponta a ponta, contra a API e o banco de verdade.
 *
 * O que esta suíte existe para garantir, além do caminho feliz:
 *   · usuário comum não alcança a fila (403) — a capacidade `anuncio.ler` que
 *     ele tem é `.proprio`, e sem a checagem de escopo ele receberia 200;
 *   · ação punitiva sem motivo é recusada (422);
 *   · suspender derruba as sessões do alvo de verdade, não só o status;
 *   · moderador não age sobre conta de Admin;
 *   · TODA ação deixou linha em `logs_auditoria`.
 *
 *   node testes/moderacao.test.js
 *
 * As rotas ainda não estão registradas em `src/routes/index.js` (arquivo que o
 * módulo não pode editar), então a suíte monta a mesma pilha do `app.js`.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const { limparLimites, encerrarInfra } = require('./apoio');
const middlewares = require(RAIZ + '/src/middlewares');
const db = require(RAIZ + '/src/models');
const moderacaoUsuarioService = require(RAIZ + '/src/features/moderacao/moderacao.usuario.service');

function criarApp() {
  const app = express();
  app.use(express.json());
  app.use(middlewares.contexto);
  app.use('/api/v1/auth', require(RAIZ + '/src/features/auth/auth.routes'));
  app.use('/api/v1/denuncias', require(RAIZ + '/src/features/denuncia/denuncia.routes'));
  app.use('/api/v1/moderacao', require(RAIZ + '/src/features/moderacao/moderacao.routes'));
  app.use(middlewares.erro);
  return app;
}

let server, base;
const req = async (metodo, caminho, corpo, token) => {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

const ok = (nome, cond, extra) =>
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));

const MARCA = `m${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function criarConta(apelido) {
  const r = await req('POST', '/auth/registrar', {
    nome: `Teste ${apelido}`,
    email: `${apelido}.${MARCA}@agropecas.dev`,
    senha: 'SenhaForte123',
    tipoPerfil: 'loja',
    nomeExibicao: `Teste ${apelido} ${MARCA}`,
    aceiteTermos: true,
    aceitePrivacidade: true,
  });
  if (r.status !== 201) throw new Error('falha ao criar conta ' + apelido + ': ' + JSON.stringify(r.corpo));
  return { id: r.corpo.dados.usuario.id, perfilId: r.corpo.dados.perfil.id, token: r.corpo.dados.tokens.acesso };
}

async function darPapel(usuarioId, chave) {
  const papel = await db.Papel.findOne({ where: { chave } });
  await db.UsuarioPapel.findOrCreate({
    where: { usuario_id: usuarioId, papel_id: papel.id },
    defaults: { usuario_id: usuarioId, papel_id: papel.id },
  });
}

const criarAnuncio = (dono, sufixo) =>
  db.Anuncio.create({
    codigo: `T${MARCA.slice(-9)}${sufixo}`,
    usuario_id: dono.id,
    perfil_id: dono.perfilId,
    tipo: 'peca',
    titulo: `Trator de teste ${MARCA}${sufixo}`,
    titulo_normalizado: `trator de teste ${MARCA}${sufixo}`,
    slug: `trator-teste-${MARCA}-${sufixo}`,
    descricao: 'Anúncio criado pela suíte automatizada.',
    preco_centavos: 250000,
    status: 'publicado',
    moderacao_status: 'nao_revisado',
    publicado_em: new Date(),
  });

const auditoriaDe = (entidade, entidadeId, acao) =>
  db.LogAuditoria.count({ where: { entidade, entidade_id: entidadeId, acao } });

(async () => {
  await limparLimites();
  server = criarApp().listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api/v1';

  const dono = await criarConta('dono');
  const comum = await criarConta('comum');
  const moderador = await criarConta('moderador');
  const admin = await criarConta('admin');
  const vitima = await criarConta('vitima');
  const banido = await criarConta('banido');
  await darPapel(moderador.id, 'moderador');
  await darPapel(admin.id, 'admin');

  const paraAprovar = await criarAnuncio(dono, 'a');
  const paraReprovar = await criarAnuncio(dono, 'b');
  const paraOcultar = await criarAnuncio(dono, 'c');
  const comFoto = await criarAnuncio(dono, 'd');
  const foto = await db.AnuncioFoto.create({
    anuncio_id: comFoto.id,
    path: `teste/${MARCA}.jpg`,
    url: `https://exemplo.test/${MARCA}.jpg`,
    principal: true,
  });

  /* uma denúncia real: é ela que faz o anúncio subir na fila priorizada */
  await req('POST', '/denuncias', { alvoTipo: 'anuncio', alvoId: paraReprovar.id, motivo: 'produto_proibido' }, comum.token);

  console.log('\n— escopo RBAC —');
  let r = await req('GET', '/moderacao/fila', null, comum.token);
  ok('usuário comum não acessa a fila → 403', r.status === 403, r.corpo);
  r = await req('GET', '/moderacao/painel', null, comum.token);
  ok('usuário comum não vê o painel → 403', r.status === 403, r.corpo);
  r = await req('POST', `/moderacao/anuncios/${paraOcultar.id}/ocultar`, { motivo: 'quero derrubar o concorrente' }, comum.token);
  ok('usuário comum não oculta anúncio alheio → 403', r.status === 403, r.corpo);
  r = await req('GET', '/moderacao/fila');
  ok('sem token → 401', r.status === 401, r.corpo);

  console.log('\n— fila e painel —');
  r = await req('GET', '/moderacao/fila', null, moderador.token);
  ok('moderador vê a fila → 200', r.status === 200, r.corpo);
  const naFila = (r.corpo?.dados || []).find((a) => a.id === paraReprovar.id);
  ok('linha traz o dono sem consulta extra (sem N+1)', naFila?.dono?.id === dono.id, naFila);
  ok('linha traz a contagem de denúncias abertas', naFila?.denunciasAbertas === 1, naFila);
  ok('primeiro da fila é o mais denunciado', r.corpo.dados[0]?.denunciasAbertas >= (naFila?.denunciasAbertas || 0), r.corpo.dados[0]);
  ok('fila não vaza dado sensível do dono', !JSON.stringify(r.corpo).includes('senha_hash'), null);

  r = await req('GET', '/moderacao/fila?somenteDenunciados=true', null, moderador.token);
  ok('filtro somenteDenunciados funciona', r.status === 200 && r.corpo.dados.every((a) => a.denunciasAbertas > 0), r.corpo?.dados?.length);

  r = await req('GET', '/moderacao/painel', null, moderador.token);
  ok('painel devolve contadores → 200', r.status === 200 && typeof r.corpo.dados.denunciasAbertas === 'number', r.corpo);
  ok('painel traz o total de pendências', typeof r.corpo.dados.totalPendencias === 'number', r.corpo?.dados);

  console.log('\n— decisões sobre anúncio —');
  r = await req('POST', `/moderacao/anuncios/${paraReprovar.id}/reprovar`, {}, moderador.token);
  ok('reprovar sem motivo → 422', r.status === 422, r.corpo);
  r = await req('POST', `/moderacao/anuncios/${paraReprovar.id}/reprovar`, { motivo: 'ok' }, moderador.token);
  ok('motivo curto demais → 422', r.status === 422, r.corpo);

  r = await req('POST', `/moderacao/anuncios/${paraReprovar.id}/reprovar`, { motivo: 'Produto proibido pelas regras da plataforma.' }, moderador.token);
  ok('reprovar com motivo → 200 e sai do ar', r.status === 200 && r.corpo.dados.status === 'oculto' && r.corpo.dados.moderacaoStatus === 'reprovado', r.corpo);
  ok('reprovação gerou auditoria', (await auditoriaDe('anuncios', paraReprovar.id, 'reprovar')) === 1, null);
  const historico = await db.AnuncioHistorico.count({ where: { anuncio_id: paraReprovar.id } });
  ok('reprovação gerou linha em anuncio_historico', historico === 1, historico);

  r = await req('POST', `/moderacao/anuncios/${paraAprovar.id}/aprovar`, { observacao: 'Conteúdo dentro das regras.' }, moderador.token);
  ok('aprovar → 200', r.status === 200 && r.corpo.dados.moderacaoStatus === 'aprovado', r.corpo);
  ok('aprovação gerou auditoria', (await auditoriaDe('anuncios', paraAprovar.id, 'aprovar')) === 1, null);

  r = await req('POST', `/moderacao/anuncios/${paraOcultar.id}/ocultar`, { motivo: 'Foto de terceiro usada sem autorização.' }, moderador.token);
  ok('ocultar → 200', r.status === 200 && r.corpo.dados.status === 'oculto', r.corpo);
  r = await req('POST', `/moderacao/anuncios/${paraOcultar.id}/ocultar`, { motivo: 'Foto de terceiro usada sem autorização.' }, moderador.token);
  ok('ocultar duas vezes → 409', r.status === 409, r.corpo);
  ok('ocultação gerou auditoria', (await auditoriaDe('anuncios', paraOcultar.id, 'ocultar')) === 1, null);

  console.log('\n— foto imprópria —');
  r = await req('POST', `/moderacao/fotos/${foto.id}/bloquear`, {}, moderador.token);
  ok('bloquear foto sem motivo → 422', r.status === 422, r.corpo);
  r = await req('POST', `/moderacao/fotos/${foto.id}/bloquear`, { motivo: 'Imagem com conteúdo impróprio.' }, moderador.token);
  ok('bloquear foto → 200', r.status === 200 && r.corpo.dados.bloqueada === true, r.corpo);
  const anuncioDaFoto = await db.Anuncio.findByPk(comFoto.id);
  ok('o anúncio continua no ar (só a imagem caiu)', anuncioDaFoto.status === 'publicado', anuncioDaFoto.status);
  ok('bloqueio de foto gerou auditoria', (await auditoriaDe('anuncio_fotos', foto.id, 'ocultar')) === 1, null);

  console.log('\n— sanção de conta —');
  r = await req('POST', `/moderacao/usuarios/${vitima.id}/suspender`, { dias: 3 }, moderador.token);
  ok('suspender sem motivo → 422', r.status === 422, r.corpo);

  const sessoesAntes = await db.Sessao.count({ where: { usuario_id: vitima.id, revogada_em: null } });
  r = await req('POST', `/moderacao/usuarios/${vitima.id}/suspender`, { motivo: 'Assédio reiterado no chat interno.', dias: 3 }, moderador.token);
  ok('suspender → 200', r.status === 200 && r.corpo.dados.status === 'suspenso', r.corpo);
  ok('suspensão tem prazo', !!r.corpo?.dados?.suspensoAte, r.corpo?.dados);
  const sessoesDepois = await db.Sessao.count({ where: { usuario_id: vitima.id, revogada_em: null } });
  ok('suspender encerrou as sessões do alvo', sessoesAntes > 0 && sessoesDepois === 0, { sessoesAntes, sessoesDepois });
  const revogada = await db.Sessao.findOne({ where: { usuario_id: vitima.id }, order: [['criado_em', 'DESC']] });
  ok('sessão revogada com o motivo certo', revogada?.revogada_motivo === 'conta_suspensa', revogada?.revogada_motivo);
  r = await req('GET', '/auth/eu', null, vitima.token);
  ok('token do suspenso deixa de valer', r.status === 401 || r.status === 423, r.corpo);
  ok('suspensão gerou auditoria', (await auditoriaDe('usuarios', vitima.id, 'suspender')) === 1, null);

  r = await req('POST', `/moderacao/usuarios/${moderador.id}/suspender`, { motivo: 'Autoperdão preventivo.' }, moderador.token);
  ok('moderador não modera a si mesmo → 403', r.status === 403 && r.corpo?.erro?.detalhe?.code === 'CONFLITO_DE_INTERESSE', r.corpo);

  r = await req('POST', `/moderacao/usuarios/${banido.id}/banir`, { motivo: 'Golpe confirmado em três denúncias.' }, moderador.token);
  ok('moderador não tem a capacidade de banir → 403', r.status === 403, r.corpo);

  /* o moderador acima é barrado pela CAPACIDADE. A trava de alvo-admin é
     outra e precisa ser exercida com quem tem a permissão: chamada direta no
     service, com um contexto que já traz `usuario.banir.todos` */
  const ctxModerador = {
    usuarioId: moderador.id,
    papeis: ['moderador'],
    permissoes: new Set(['usuario.banir.todos', 'usuario.suspender.todos']),
    admin: false,
    autenticado: true,
    ipHash: 'b'.repeat(64),
    userAgent: 'teste',
    origem: 'web',
  };
  const recusa = await moderacaoUsuarioService
    .banir(ctxModerador, admin.id, { motivo: 'Tentativa de derrubar o administrador.' })
    .then(() => null)
    .catch((erro) => erro);
  ok('moderador não bane admin → 403', recusa?.statusCode === 403 && recusa?.detalhe?.code === 'ALVO_ADMINISTRADOR', recusa?.message);
  const adminIntacto = await db.Usuario.findByPk(admin.id);
  ok('a conta do admin segue ativa', adminIntacto.status !== 'banido', adminIntacto.status);

  r = await req('POST', `/moderacao/usuarios/${banido.id}/banir`, { motivo: 'Golpe confirmado em três denúncias.' }, admin.token);
  ok('admin bane → 200', r.status === 200 && r.corpo.dados.status === 'banido', r.corpo);
  ok('banimento gerou auditoria', (await auditoriaDe('usuarios', banido.id, 'banir')) === 1, null);
  r = await req('POST', `/moderacao/usuarios/${banido.id}/banir`, { motivo: 'Golpe confirmado em três denúncias.' }, admin.token);
  ok('banir duas vezes → 409', r.status === 409, r.corpo);

  r = await req('POST', `/moderacao/usuarios/${banido.id}/restaurar`, { motivo: 'Recurso aceito pelo suporte.' }, admin.token);
  ok('admin restaura → 200', r.status === 200 && r.corpo.dados.status === 'ativo', r.corpo);
  ok('restauração gerou auditoria', (await auditoriaDe('usuarios', banido.id, 'restaurar')) === 1, null);

  console.log('\n— histórico —');
  r = await req('GET', `/moderacao/anuncios/${paraReprovar.id}/historico`, null, moderador.token);
  ok('histórico do anúncio diz o quê, quem e por quê', r.status === 200 && r.corpo.dados[0]?.motivo && r.corpo.dados[0]?.autorId === moderador.id, r.corpo);
  ok('histórico não expõe ip_hash', !JSON.stringify(r.corpo).includes('ip_hash'), null);

  const acessosAntes = await db.LogAcessoDado.count({ where: { titular_id: banido.id, recurso: 'ficha_moderacao' } });
  r = await req('GET', `/moderacao/usuarios/${banido.id}/historico`, null, moderador.token);
  ok('histórico de sanções da conta → 200', r.status === 200 && r.corpo.dados.some((l) => l.acao === 'banir'), r.corpo);
  const acessosDepois = await db.LogAcessoDado.count({ where: { titular_id: banido.id, recurso: 'ficha_moderacao' } });
  ok('leitura da ficha grava logs_acesso_dado (LGPD)', acessosDepois === acessosAntes + 1, { acessosAntes, acessosDepois });

  console.log('\n— toda ação deixou rastro —');
  const esperadas = [
    ['anuncios', paraAprovar.id, 'aprovar'],
    ['anuncios', paraReprovar.id, 'reprovar'],
    ['anuncios', paraOcultar.id, 'ocultar'],
    ['anuncio_fotos', foto.id, 'ocultar'],
    ['usuarios', vitima.id, 'suspender'],
    ['usuarios', banido.id, 'banir'],
    ['usuarios', banido.id, 'restaurar'],
  ];
  const faltando = [];
  for (const [entidade, id, acao] of esperadas) {
    if ((await auditoriaDe(entidade, id, acao)) < 1) faltando.push(`${acao}:${entidade}`);
  }
  ok('as 7 ações de moderação estão em logs_auditoria', faltando.length === 0, faltando);

  const semMotivo = await db.LogAuditoria.count({
    where: {
      acao: ['reprovar', 'ocultar', 'suspender', 'banir'],
      entidade_id: [paraReprovar.id, paraOcultar.id, foto.id, vitima.id, banido.id],
      motivo: null,
    },
  });
  ok('nenhuma ação punitiva foi gravada sem motivo', semMotivo === 0, semMotivo);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
