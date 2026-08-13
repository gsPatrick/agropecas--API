'use strict';

/**
 * Módulo de plano, pela rede e contra o banco de verdade.
 *
 *   node testes/plano.test.js
 *
 * O que interessa aqui não é o CRUD — é o comportamento do qual TODOS os
 * outros módulos dependem: limite nulo é ilimitado, quem não tem assinatura
 * cai no gratuito, e `podeUsar` barra quando o teto existe e estourou. Errar
 * qualquer um dos três trava a plataforma inteira ou abre a porteira.
 *
 * As rotas da feature ainda não estão em `src/routes/index.js` (o arquivo é
 * compartilhado e o orquestrador é quem monta), então a suíte sobe um segundo
 * servidor com o router do módulo. É o mesmo router que a API vai usar.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const { limparLimites, encerrarInfra } = require('./apoio');
const app = require(RAIZ + '/app');
const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');
const plano = require(RAIZ + '/src/features/plano');
const cachePlano = require(RAIZ + '/src/features/plano/plano.cache');

const MARCA = `t${Date.now()}`;

let servidorAuth;
let servidorPlano;
let baseAuth;
let basePlano;

const chamar = (base) => async (metodo, caminho, corpo, token) => {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

let falhas = 0;
const ok = (nome, condicao, extra) => {
  if (!condicao) falhas += 1;
  console.log((condicao ? '  ok  ' : ' FALHA') + ' ' + nome + (condicao ? '' : ' → ' + JSON.stringify(extra)));
};

(async () => {
  await limparLimites();

  servidorAuth = app.listen(0);
  baseAuth = 'http://127.0.0.1:' + servidorAuth.address().port + '/api/v1/auth';
  const auth = chamar(baseAuth);

  const apiPlano = express();
  apiPlano.use(express.json());
  apiPlano.use(middlewares.contexto);
  apiPlano.use('/planos', require(RAIZ + '/src/features/plano/plano.routes'));
  apiPlano.use(middlewares.erro);
  servidorPlano = apiPlano.listen(0);
  basePlano = 'http://127.0.0.1:' + servidorPlano.address().port;
  const req = chamar(basePlano);

  const cadastrar = async (sufixo, tipo) => {
    const email = `plano-${sufixo}-${MARCA}@agropecas.dev`;
    const r = await auth('POST', '/registrar', {
      nome: 'Fulano ' + sufixo,
      email,
      senha: 'SenhaForte123',
      tipoPerfil: tipo,
      aceiteTermos: true,
      aceitePrivacidade: true,
    });
    if (!r.corpo?.dados) throw new Error('cadastro falhou: ' + JSON.stringify(r.corpo));
    return { email, ...r.corpo.dados };
  };

  const anunciante = await cadastrar('anunciante', 'loja');
  const outro = await cadastrar('outro', 'produtor');

  const usuarioAnunciante = await db.Usuario.findOne({
    where: { email_normalizado: anunciante.email.toLowerCase() },
  });
  const usuarioOutro = await db.Usuario.findOne({
    where: { email_normalizado: outro.email.toLowerCase() },
  });

  // ── vitrine pública ───────────────────────────────────────────
  console.log('\n— catálogo público —');
  let r = await req('GET', '/planos');
  ok('lista planos sem autenticação → 200', r.status === 200, r.corpo);
  const gratuito = (r.corpo?.dados || []).find((item) => item.chave === 'gratuito_mvp');
  ok('plano gratuito do MVP está na vitrine', !!gratuito, r.corpo?.dados);
  ok('plano gratuito custa zero', gratuito?.precoCentavos === 0, gratuito);

  const limiteAtivos = (gratuito?.limites || []).find((item) => item.chave === 'anuncios.ativos');
  ok('limite nulo é devolvido como ilimitado', limiteAtivos?.valor === null && limiteAtivos?.ilimitado === true, limiteAtivos);

  // ── sem assinatura cai no gratuito ────────────────────────────
  console.log('\n— usuário sem assinatura —');
  const assinaturasDele = await db.Assinatura.count({ where: { usuario_id: usuarioAnunciante.id } });
  ok('o cadastro realmente não criou assinatura (é o caso que interessa)', assinaturasDele === 0, assinaturasDele);

  r = await req('GET', '/planos/minha-assinatura', null, anunciante.tokens.acesso);
  ok('minha-assinatura responde mesmo sem assinatura → 200', r.status === 200, r.corpo);
  ok('e o plano efetivo é o gratuito padrão', r.corpo?.dados?.planoChave === 'gratuito_mvp', r.corpo?.dados);
  ok('marcado como origem "padrao", não "assinatura"', r.corpo?.dados?.origem === 'padrao', r.corpo?.dados);
  ok('traz o uso de cada limite do plano', Array.isArray(r.corpo?.dados?.uso) && r.corpo.dados.uso.length > 0, r.corpo?.dados?.uso);

  // ── limite nulo = ilimitado ───────────────────────────────────
  console.log('\n— limite nulo é ILIMITADO (não zero) —');
  let veredito = await plano.podeUsar(usuarioAnunciante.id, 'anuncios.ativos');
  ok('podeUsar → permitido com limite null', veredito.permitido === true && veredito.limite === null, veredito);
  ok('marcado explicitamente como ilimitado', veredito.ilimitado === true, veredito);

  await plano.registrarUso(usuarioAnunciante.id, 'anuncios.ativos', 50);
  veredito = await plano.podeUsar(usuarioAnunciante.id, 'anuncios.ativos');
  ok('depois de 50 usos continua permitido (ilimitado é ilimitado)', veredito.permitido === true, veredito);

  console.log('\n— chave desconhecida também é ilimitada —');
  veredito = await plano.podeUsar(usuarioAnunciante.id, 'chave.que.ninguem.cadastrou');
  ok('quota não cadastrada não bloqueia', veredito.permitido === true && veredito.ilimitado === true, veredito);

  console.log('\n— a chave aceita ponto e underline —');
  veredito = await plano.podeUsar(usuarioAnunciante.id, 'anuncios_ativos');
  ok('"anuncios_ativos" normaliza para "anuncios.ativos"', veredito.chave === 'anuncios.ativos', veredito);

  // ── administração ─────────────────────────────────────────────
  console.log('\n— só o Admin cria e edita plano —');
  const novoPlano = {
    chave: `teste_${MARCA}`,
    nome: 'Plano de teste',
    precoCentavos: 9900,
    periodicidade: 'mensal',
    limites: [{ chave: 'anuncios.ativos', valor: 2, periodo: 'total', descricao: 'teto de teste' }],
  };

  r = await req('POST', '/planos', novoPlano, anunciante.tokens.acesso);
  ok('usuário comum criando plano → 403', r.status === 403, r.corpo);

  r = await req('POST', '/planos/atribuir', { usuarioId: usuarioOutro.id }, anunciante.tokens.acesso);
  ok('usuário comum atribuindo plano → 403', r.status === 403, r.corpo);

  const papelAdmin = await db.Papel.findOne({ where: { chave: 'admin' } });
  await db.UsuarioPapel.create({ usuario_id: usuarioAnunciante.id, papel_id: papelAdmin.id });
  const relogin = await auth('POST', '/entrar', { email: anunciante.email, senha: 'SenhaForte123' });
  const tokenAdmin = relogin.corpo.dados.tokens.acesso;
  ok('papel de admin vale na hora', relogin.corpo.dados.papeis.includes('admin'), relogin.corpo.dados.papeis);

  r = await req('POST', '/planos', { chave: novoPlano.chave }, tokenAdmin);
  ok('plano sem nome → 422', r.status === 422, r.corpo);

  r = await req('POST', '/planos', novoPlano, tokenAdmin);
  ok('admin cria plano → 201', r.status === 201, r.corpo);
  const planoCriado = r.corpo?.dados;
  ok('limite gravado com o teto pedido', planoCriado?.limites?.[0]?.valor === 2, planoCriado?.limites);

  r = await req('POST', '/planos', novoPlano, tokenAdmin);
  ok('chave duplicada → 409', r.status === 409, r.corpo);

  // ── podeUsar bloqueia ao estourar ─────────────────────────────
  console.log('\n— podeUsar BLOQUEIA quando o teto existe e estourou —');
  r = await req(
    'POST',
    '/planos/atribuir',
    { usuarioId: usuarioOutro.id, planoId: planoCriado.id, motivo: 'teste automatizado' },
    tokenAdmin
  );
  ok('admin atribui plano → 201', r.status === 201, r.corpo);

  veredito = await plano.podeUsar(usuarioOutro.id, 'anuncios.ativos');
  ok('teto de 2 aparece para quem assinou', veredito.limite === 2 && veredito.usado === 0, veredito);
  ok('e a resposta traz o restante', veredito.restante === 2 && veredito.permitido === true, veredito);

  await plano.registrarUso(usuarioOutro.id, 'anuncios.ativos', 1);
  veredito = await plano.podeUsar(usuarioOutro.id, 'anuncios.ativos');
  ok('depois de 1 uso: 1 restante, ainda permitido', veredito.usado === 1 && veredito.restante === 1 && veredito.permitido, veredito);

  await plano.registrarUso(usuarioOutro.id, 'anuncios.ativos', 1);
  veredito = await plano.podeUsar(usuarioOutro.id, 'anuncios.ativos');
  ok('no teto: permitido = false', veredito.permitido === false && veredito.usado === 2 && veredito.restante === 0, veredito);

  let erroDeLimite = null;
  await plano.exigirLimite(usuarioOutro.id, 'anuncios.ativos').catch((erro) => {
    erroDeLimite = erro;
  });
  ok('exigirLimite lança 403 padronizado', erroDeLimite?.statusCode === 403, erroDeLimite?.message);

  await plano.registrarUso(usuarioOutro.id, 'anuncios.ativos', -1);
  veredito = await plano.podeUsar(usuarioOutro.id, 'anuncios.ativos');
  ok('devolver a vaga libera de novo', veredito.permitido === true && veredito.usado === 1, veredito);

  await plano.registrarUso(usuarioOutro.id, 'anuncios.ativos', -50);
  const zerado = await db.UsoMedido.findOne({
    where: { usuario_id: usuarioOutro.id, chave: 'anuncios.ativos' },
  });
  ok('contador nunca fica negativo', Number(zerado.quantidade) === 0, zerado?.quantidade);

  console.log('\n— limite volta a ilimitado quando o Admin grava null —');
  r = await req(
    'PUT',
    `/planos/${planoCriado.id}/limites`,
    { limites: [{ chave: 'anuncios.ativos', valor: null, periodo: 'total' }] },
    tokenAdmin
  );
  ok('admin define limite null → 200', r.status === 200, r.corpo);
  ok('gravado como ilimitado', r.corpo?.dados?.limites?.[0]?.ilimitado === true, r.corpo?.dados?.limites);

  await cachePlano.invalidarUsuario(usuarioOutro.id);
  await plano.registrarUso(usuarioOutro.id, 'anuncios.ativos', 99);
  veredito = await plano.podeUsar(usuarioOutro.id, 'anuncios.ativos');
  ok('com 99 usos e limite null, continua permitido', veredito.permitido === true && veredito.ilimitado === true, veredito);

  // ── escopo: uso é sempre o próprio ────────────────────────────
  console.log('\n— o usuário só enxerga o próprio consumo —');
  r = await req('GET', '/planos/meus-limites/anuncios.ativos', null, outro.tokens.acesso);
  ok('meus-limites responde com o veredito do próprio token → 200', r.status === 200, r.corpo);
  ok('sem teto, o veredito não faz consulta de uso', r.corpo?.dados?.ilimitado === true && r.corpo?.dados?.usado === 0, r.corpo?.dados);

  r = await req('GET', '/planos/minha-assinatura', null, outro.tokens.acesso);
  const itemUso = (r.corpo?.dados?.uso || []).find((item) => item.chave === 'anuncios.ativos');
  ok('o consumo real aparece em minha-assinatura', itemUso?.usado === 99, itemUso);
  ok('e é o dele, não o do outro anunciante', r.corpo?.dados?.origem === 'assinatura', r.corpo?.dados);

  r = await req('GET', '/planos/minha-assinatura', null, null);
  ok('minha-assinatura sem token → 401', r.status === 401, r.corpo);

  // ── auditoria ─────────────────────────────────────────────────
  console.log('\n— rastro —');
  const registro = await db.LogAuditoria.findOne({
    where: { entidade: 'assinatura', em_nome_de: usuarioOutro.id },
    order: [['criado_em', 'DESC']],
  });
  ok('atribuição de plano ficou em logs_auditoria', !!registro, registro?.acao);
  ok('com o plano de destino registrado', !!registro?.depois?.planoChave, registro?.depois);

  const registroLimite = await db.LogAuditoria.findOne({
    where: { entidade: 'plano', entidade_id: planoCriado.id, acao: 'editar' },
    order: [['criado_em', 'DESC']],
  });
  ok('mudança de limite ficou em logs_auditoria', !!registroLimite, registroLimite?.acao);
  ok('com o antes e o depois dos limites', !!registroLimite?.depois?.limites, registroLimite?.depois);

  // ── remoção protegida ─────────────────────────────────────────
  console.log('\n— proteções do CRUD —');
  r = await req('DELETE', `/planos/${planoCriado.id}`, null, tokenAdmin);
  ok('plano com assinante ativo não é removido → 409', r.status === 409, r.corpo);

  const planoPadraoDb = await db.Plano.findOne({ where: { chave: 'gratuito_mvp' } });
  r = await req('DELETE', `/planos/${planoPadraoDb.id}`, null, tokenAdmin);
  ok('plano padrão da plataforma não pode ser removido → 400', r.status === 400, r.corpo);

  // ── faxina do que o teste criou ───────────────────────────────
  await db.Assinatura.destroy({ where: { plano_id: planoCriado.id } });
  r = await req('DELETE', `/planos/${planoCriado.id}`, null, tokenAdmin);
  ok('sem assinante, o plano é removido → 200', r.status === 200, r.corpo);

  await db.UsoMedido.destroy({ where: { usuario_id: [usuarioAnunciante.id, usuarioOutro.id] } });
  await db.PlanoLimite.destroy({ where: { plano_id: planoCriado.id } });
  await db.Plano.destroy({ where: { id: planoCriado.id }, force: true });

  console.log(falhas === 0 ? '\n✅ plano: todas as verificações passaram' : `\n❌ plano: ${falhas} falha(s)`);

  servidorAuth.close();
  servidorPlano.close();
  await db.sequelize.close();
  await encerrarInfra();
  process.exit(falhas === 0 ? 0 : 1);
})().catch((erro) => {
  console.error('ERRO:', erro);
  servidorAuth?.close();
  servidorPlano?.close();
  process.exit(1);
});
