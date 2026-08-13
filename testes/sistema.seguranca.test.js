'use strict';

/**
 * Auditoria de segurança do SISTEMA INTEIRO.
 *
 * A suíte de `auth.seguranca` ataca só a autenticação. Esta ataca a superfície
 * que os 17 módulos criaram: 168 endpoints, escopo por dono, dado pessoal em
 * resposta pública, e as rotas que revelam contato — que é o ativo da
 * plataforma.
 *
 * "BLOQUEADO" é o resultado desejado. Um "PASSOU" é uma falha aberta.
 *
 *   npm run test:sistema
 */

const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');
const app = require(RAIZ + '/app');
const db = require(RAIZ + '/src/models');

let server;
let base;

const req = async (metodo, caminho, corpo, token) => {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

const R = [];
const ok = (nome, condicao, extra) => {
  R.push(condicao);
  console.log(
    (condicao ? '  BLOQUEADO ' : '  ⚠️ PASSOU  ') +
      nome +
      (condicao ? '' : ' → ' + JSON.stringify(extra).slice(0, 200))
  );
};

const marca = Date.now();

async function conta(sufixo, tipo = 'produtor') {
  const email = `sis${sufixo}${marca}@x.dev`;
  const r = await req('POST', '/api/v1/auth/registrar', {
    nome: `Fulano ${sufixo}`,
    email,
    senha: 'SenhaForte123',
    tipoPerfil: tipo,
    whatsapp: '65999990000',
    aceiteTermos: true,
    aceitePrivacidade: true,
  });
  return { email, ...r.corpo.dados };
}

(async () => {
  await limparLimites();
  server = app.listen(0);
  base = 'http://127.0.0.1:' + server.address().port;

  const dono = await conta('dono', 'loja');
  const intruso = await conta('intruso');

  // ─────────────────────────────────────────────────────────────
  console.log('\n══ ROTA AUTENTICADA SEM TOKEN ══');
  const PROTEGIDAS = [
    ['GET', '/api/v1/auth/eu'],
    ['GET', '/api/v1/usuarios/eu'],
    ['GET', '/api/v1/anuncios/meus'],
    ['GET', '/api/v1/conversas'],
    ['GET', '/api/v1/notificacoes'],
    ['GET', '/api/v1/favoritos'],
    ['GET', '/api/v1/auditoria'],
    ['GET', '/api/v1/moderacao/fila'],
    ['GET', '/api/v1/denuncias'],
    ['GET', '/api/v1/relatorios/painel?de=2026-07-01&ate=2026-08-01'],
    ['GET', '/api/v1/midia'],
    ['GET', '/api/v1/perfis/meu'],
  ];
  for (const [metodo, rota] of PROTEGIDAS) {
    const r = await req(metodo, rota);
    ok(`${rota} sem token`, r.status === 401, r.status);
  }

  // ─────────────────────────────────────────────────────────────
  console.log('\n══ PRIVILÉGIO: USUÁRIO COMUM EM ROTA DE ADMIN ══');
  const ADMIN = [
    ['GET', '/api/v1/auditoria', null],
    ['GET', '/api/v1/moderacao/fila', null],
    ['GET', '/api/v1/moderacao/painel', null],
    ['GET', '/api/v1/denuncias', null],
    /* com período válido: sem ele a validação responde antes da autorização
       e o teste mediria a coisa errada */
    ['GET', '/api/v1/relatorios/painel?de=2026-07-01&ate=2026-08-01', null],
    ['GET', '/api/v1/usuarios', null],
    ['POST', '/api/v1/catalogo/categorias', { nome: 'Invadida', tipo: 'peca' }],
    ['POST', '/api/v1/catalogo/marcas', { nome: 'Invadida' }],
    ['POST', '/api/v1/planos', { chave: 'pirata', nome: 'Pirata' }],
    ['PUT', '/api/v1/configuracoes/anuncio.dias_validade', { valor: 9999 }],
  ];
  for (const [metodo, rota, corpo] of ADMIN) {
    const r = await req(metodo, rota, corpo, intruso.tokens.acesso);
    ok(`${metodo} ${rota} como usuário comum`, r.status === 403 || r.status === 404, r.status);
  }

  console.log('\n── as três permissões que vazavam para todo cadastro ──');
  const papelUsuario = await db.Papel.findOne({
    where: { chave: 'usuario' },
    include: [{ model: db.Permissao, as: 'permissoes', through: { attributes: [] } }],
  });
  const daConta = papelUsuario.permissoes.map((p) => p.chave);
  ['usuario.criar', 'notificacao.template_editar', 'lgpd.publicar_documento'].forEach((chave) =>
    ok(`papel usuario NÃO tem ${chave}`, !daConta.includes(chave), chave)
  );

  // ─────────────────────────────────────────────────────────────
  console.log('\n══ ESCOPO: MEXER NO QUE É DE OUTRO ══');
  const r1 = await req(
    'POST',
    '/api/v1/anuncios',
    {
      tipo: 'peca',
      titulo: `Bomba injetora sistema ${marca}`,
      descricao: 'Peça revisada para teste de segurança do sistema.',
      condicao: 'usada',
      negociacao: 'venda',
      precoCentavos: 100000,
      municipioId: (await db.Municipio.findOne({ where: { uf: 'MT' } })).id,
    },
    dono.tokens.acesso
  );
  const anuncioId = r1.corpo?.dados?.id;

  const ALHEIAS = [
    ['PATCH', `/api/v1/anuncios/${anuncioId}`, { titulo: 'Sequestrado' }],
    ['DELETE', `/api/v1/anuncios/${anuncioId}`, { motivo: 'x' }],
    ['POST', `/api/v1/anuncios/${anuncioId}/publicar`, {}],
    ['GET', `/api/v1/anuncios/${anuncioId}/metricas`, null],
    ['GET', `/api/v1/anuncios/${anuncioId}/contatos`, null],
    ['PATCH', `/api/v1/perfis/${dono.perfil.id}`, { nomeExibicao: 'Sequestrado' }],
    ['POST', `/api/v1/perfis/${dono.perfil.id}/verificacao`, { observacao: 'eu mesmo' }],
    ['PATCH', `/api/v1/usuarios/${dono.usuario.id}`, { nome: 'Sequestrado' }],
    ['POST', `/api/v1/usuarios/${dono.usuario.id}/banir`, { motivo: 'porque sim' }],
  ];
  for (const [metodo, rota, corpo] of ALHEIAS) {
    const r = await req(metodo, rota, corpo, intruso.tokens.acesso);
    ok(`${metodo} ${rota.replace(/[0-9a-f-]{36}/, ':id')} de terceiro`, [403, 404].includes(r.status), r.status);
  }

  const aindaIntacto = await db.Anuncio.findByPk(anuncioId);
  ok('o anúncio alheio continua intacto no banco', aindaIntacto?.titulo?.includes('Bomba injetora'), aindaIntacto?.titulo);
  const perfilIntacto = await db.Perfil.findByPk(dono.perfil.id);
  ok('o perfil alheio não foi verificado por terceiro', !perfilIntacto.verificado_em, perfilIntacto.verificado_em);

  // ─────────────────────────────────────────────────────────────
  console.log('\n══ DADO PESSOAL EM ROTA PÚBLICA ══');
  await req('POST', `/api/v1/anuncios/${anuncioId}/publicar`, {}, dono.tokens.acesso);

  const publico = await req('GET', `/api/v1/anuncios/${anuncioId}`);
  const textoPublico = JSON.stringify(publico.corpo);
  ok('detalhe público não traz senha_hash', !textoPublico.includes('senha_hash') && !textoPublico.includes('$2b$'));
  ok('detalhe público não traz ip_hash', !textoPublico.includes('ip_hash'));
  ok('detalhe público não traz observacoes_internas', !textoPublico.includes('observacoes_internas'));
  ok('detalhe público não traz e-mail do dono', !textoPublico.includes(dono.email), dono.email);
  ok('detalhe público não traz documento (CPF/CNPJ)', !/"documento"/.test(textoPublico));

  const perfilPublico = await req('GET', `/api/v1/perfis/${dono.perfil.slug}`);
  const textoPerfil = JSON.stringify(perfilPublico.corpo);
  ok('perfil público não traz documento', !/"documento"\s*:\s*"/.test(textoPerfil));
  ok('perfil público não traz e-mail da conta', !textoPerfil.includes(dono.email));

  console.log('\n── consentimento de WhatsApp (LGPD, não preferência de UI) ──');
  await db.Perfil.update({ exibir_whatsapp: false }, { where: { id: dono.perfil.id } });
  await require(RAIZ + '/src/cache').invalidar(require(RAIZ + '/src/cache/chaves').base() + ':*');

  const semZap = await req('GET', `/api/v1/perfis/${dono.perfil.slug}`);
  ok(
    'exibir_whatsapp=false esconde o número no perfil',
    !JSON.stringify(semZap.corpo).includes('5565999990000'),
    semZap.corpo?.dados?.whatsapp
  );

  const anuncioSemZap = await req('GET', `/api/v1/anuncios/${anuncioId}`);
  ok(
    'exibir_whatsapp=false esconde o número no anúncio',
    !JSON.stringify(anuncioSemZap.corpo).includes('5565999990000'),
    anuncioSemZap.corpo?.dados?.anunciante
  );

  const revelado = await req('POST', `/api/v1/contatos/anuncios/${anuncioId}/revelar`, {}, intruso.tokens.acesso);
  ok(
    'revelar contato respeita exibir_whatsapp=false',
    !JSON.stringify(revelado.corpo).includes('5565999990000'),
    revelado.corpo
  );

  console.log('\n── revelar contato exige login (raspagem de telefones) ──');
  const semLogin = await req('POST', `/api/v1/contatos/anuncios/${anuncioId}/revelar`, {});
  ok('revelar contato sem token', semLogin.status === 401, semLogin.status);

  // ─────────────────────────────────────────────────────────────
  console.log('\n══ INJEÇÃO E ENTRADA MALICIOSA ══');
  const INJECOES = [
    "' OR 1=1 --",
    "'; DROP TABLE anuncios; --",
    "%' UNION SELECT senha_hash FROM usuarios --",
  ];
  for (const payload of INJECOES) {
    const r = await req('GET', `/api/v1/busca?q=${encodeURIComponent(payload)}`);
    ok(
      `busca com "${payload.slice(0, 22)}…"`,
      r.status < 500 && !JSON.stringify(r.corpo || {}).includes('$2b$'),
      r.status
    );
  }
  const tabelas = await db.sequelize.query("select to_regclass('public.anuncios') as t", { plain: true });
  ok('a tabela anuncios continua existindo', Boolean(tabelas.t));

  const r2 = await req('GET', '/api/v1/busca?porPagina=999999');
  const qtd = (r2.corpo?.dados || []).length;
  ok('porPagina absurdo é limitado', qtd <= 100, qtd);

  // ─────────────────────────────────────────────────────────────
  console.log('\n══ MASS ASSIGNMENT ══');
  const escalada = await req(
    'POST',
    '/api/v1/auth/registrar',
    {
      nome: 'Escalador Teste',
      email: `escalada${marca}@x.dev`,
      senha: 'SenhaForte123',
      tipoPerfil: 'produtor',
      aceiteTermos: true,
      aceitePrivacidade: true,
      papeis: ['admin'],
      status: 'ativo',
      verificado_em: new Date(),
    },
    null
  );
  ok('papel admin injetado no cadastro', !(escalada.corpo?.dados?.papeis || []).includes('admin'), escalada.corpo?.dados?.papeis);
  ok('status forçado no cadastro', escalada.corpo?.dados?.usuario?.status === 'pendente', escalada.corpo?.dados?.usuario?.status);

  const forjado = await req(
    'PATCH',
    '/api/v1/usuarios/eu',
    { nome: 'Nome Novo', status: 'ativo', usuario_id: dono.usuario.id, total_logins: 9999 },
    intruso.tokens.acesso
  );
  const intrusoDepois = await db.Usuario.findByPk(intruso.usuario.id);
  ok('campo de sistema no corpo é descartado', intrusoDepois.total_logins !== 9999, intrusoDepois.total_logins);
  ok('usuario_id no corpo não redireciona a escrita', (await db.Usuario.findByPk(dono.usuario.id)).nome !== 'Nome Novo');

  // ─────────────────────────────────────────────────────────────
  console.log('\n══ AUDITORIA E LGPD ══');
  const trilha = await req('GET', '/api/v1/auditoria', null, intruso.tokens.acesso);
  ok('trilha de auditoria fechada para usuário comum', trilha.status === 403, trilha.status);

  for (const metodo of ['PATCH', 'PUT', 'DELETE']) {
    const r = await req(metodo, '/api/v1/auditoria/qualquer-id', { acao: 'apagar' }, dono.tokens.acesso);
    ok(`${metodo} na trilha (log é imutável)`, [403, 404, 405].includes(r.status), r.status);
  }

  const logs = await db.LogAuditoria.findAll({ limit: 200, order: [['criado_em', 'DESC']] });
  ok('auditoria gravou as ações do teste', logs.length > 0, logs.length);
  ok(
    'IP na auditoria só em hash',
    logs.every((l) => !l.ip_hash || /^[0-9a-f]{64}$/.test(l.ip_hash)),
    logs.find((l) => l.ip_hash && !/^[0-9a-f]{64}$/.test(l.ip_hash))?.ip_hash
  );

  const consentimentos = await db.Consentimento.findAll({ where: { usuario_id: dono.usuario.id } });
  ok('consentimento gravado no cadastro', consentimentos.length >= 2, consentimentos.length);
  ok(
    'IP do consentimento só em hash',
    consentimentos.every((c) => !c.ip_hash || /^[0-9a-f]{64}$/.test(c.ip_hash))
  );

  const solicitacaoAlheia = await req(
    'POST',
    '/api/v1/lgpd/solicitacoes',
    { tipo: 'acesso', usuarioId: dono.usuario.id },
    intruso.tokens.acesso
  );
  const criadaNoNomeDoDono = await db.SolicitacaoTitular.findOne({
    where: { usuario_id: dono.usuario.id },
  });
  ok('solicitação LGPD não é criada em nome de terceiro', !criadaNoNomeDoDono, solicitacaoAlheia.status);

  // ─────────────────────────────────────────────────────────────
  console.log('\n══ CABEÇALHOS DE SEGURANÇA ══');
  const cru = await fetch(base + '/api/v1/ping');
  ok('X-Content-Type-Options: nosniff', cru.headers.get('x-content-type-options') === 'nosniff');
  ok('Referrer-Policy presente', Boolean(cru.headers.get('referrer-policy')));
  ok('X-Powered-By escondido', !cru.headers.get('x-powered-by'));
  ok('X-Request-Id devolvido', Boolean(cru.headers.get('x-request-id')));

  console.log('\n' + '─'.repeat(62));
  const bloqueados = R.filter(Boolean).length;
  console.log(`${bloqueados}/${R.length} vetores bloqueados`);

  server.close();
  await encerrarInfra();
  await db.sequelize.close();
  process.exit(bloqueados === R.length ? 0 : 1);
})().catch(async (erro) => {
  console.error('erro na auditoria:', erro);
  server?.close();
  process.exit(1);
});
