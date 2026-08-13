'use strict';

/**
 * Painel administrativo — contas, sanções, papéis, lote e perfis.
 *
 * O foco desta suíte são os vetores que a revisão cobra: motivo obrigatório,
 * conflito de interesse, teto de lote, e as duas trilhas que a LGPD exige —
 * `logs_acesso_dado` ao LER cadastro alheio e `logs_auditoria` a cada AÇÃO.
 * Por isso ela consulta o banco depois de cada chamada: um endpoint que
 * responde 200 sem deixar rastro passaria em qualquer teste que só olhasse o
 * corpo da resposta.
 *
 *   node testes/admin.usuarios.test.js
 *
 * NOTA DE MONTAGEM: igual à de `admin.painel.test.js` — `/v1/admin` ainda não
 * está montado em `src/routes/index.js`, então a suíte sobe um app com a mesma
 * pilha de middlewares e a mesma ordem do contrato de `admin.routes.js`.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const { Op } = require('sequelize');
const express = require('express');
const crypto = require('crypto');
const { limparLimites, encerrarInfra } = require('./apoio');
const app = require(RAIZ + '/app');
const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');

const { autenticar, autorizar, validar, rateLimit } = middlewares;

let servidorAuth;
let servidorAdmin;
let baseAuth;
let baseAdmin;

const req = async (base, metodo, caminho, corpo, token) => {
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

const auth = (metodo, caminho, corpo, token) => req(baseAuth, metodo, caminho, corpo, token);
const admin = (metodo, caminho, corpo, token) => req(baseAdmin, metodo, caminho, corpo, token);

function cnpjValido() {
  const base = Array.from({ length: 12 }, (_, i) => (i < 8 ? Math.floor(Math.random() * 10) : [0, 0, 0, 1][i - 8]));
  const dv = (nums) => {
    let peso = nums.length - 7;
    let soma = 0;
    for (let i = 0; i < nums.length; i++) {
      soma += nums[i] * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

let contador = 0;
async function criarConta(rotulo) {
  contador += 1;
  const email = `admin-usuarios-${Date.now()}-${contador}@agropecas.dev`;
  const documento = cnpjValido();

  const r = await auth('POST', '/registrar', {
    nome: `Conta ${rotulo} Teste`,
    email,
    senha: 'SenhaForte123',
    tipoPerfil: 'loja',
    nomeExibicao: `Loja ${rotulo} ${Date.now()}${contador}`,
    documento,
    razaoSocial: `Loja ${rotulo} LTDA`,
    aceiteTermos: true,
    aceitePrivacidade: true,
  });

  if (r.status !== 201) throw new Error(`falha ao criar conta ${rotulo}: ${JSON.stringify(r.corpo)}`);

  return {
    email,
    documento,
    id: r.corpo.dados.usuario.id,
    perfilId: r.corpo.dados.perfil.id,
    token: r.corpo.dados.tokens.acesso,
  };
}

async function comPapel(conta, chave) {
  const papel = await db.Papel.findOne({ where: { chave } });
  await db.UsuarioPapel.create({ usuario_id: conta.id, papel_id: papel.id });

  const r = await auth('POST', '/entrar', { email: conta.email, senha: 'SenhaForte123' });
  return { ...conta, token: r.corpo.dados.tokens.acesso };
}

/** contagens no banco — é assim que se prova que a trilha existe de verdade */
const contarAcessos = (atorId, titularId) =>
  db.LogAcessoDado.count({ where: { ator_id: atorId, ...(titularId ? { titular_id: titularId } : {}) } });

const contarAuditoria = (atorId, acao) =>
  db.LogAuditoria.count({ where: { ator_id: atorId, ...(acao ? { acao } : {}) } });

function montarAdmin() {
  try {
    return { router: require(RAIZ + '/src/features/admin/admin.routes'), oficial: true };
  } catch (erro) {
    const usuarios = require(RAIZ + '/src/features/admin/controllers/admin.usuarios.controller');
    const esquemas = require(RAIZ + '/src/features/admin/admin.validators');

    const router = express.Router();
    router.use(autenticar, autorizar('admin.acessar'));

    router.get('/usuarios', autorizar('usuario.ler'), validar.query(esquemas.listarUsuarios), usuarios.listar);
    router.get('/usuarios/:id', autorizar('usuario.ler'), validar.params(esquemas.identificador), usuarios.ver);
    router.get('/usuarios/:id/atividade', autorizar('usuario.ler'), validar.params(esquemas.identificador), usuarios.atividade);
    router.patch('/usuarios/:id', rateLimit.escrita(), autorizar('usuario.editar'), validar.params(esquemas.identificador), validar(esquemas.editarUsuario), usuarios.editar);

    router.post('/usuarios/:id/suspender', rateLimit.escrita(), autorizar('usuario.suspender'), validar.params(esquemas.identificador), validar(esquemas.sancao), usuarios.suspender);
    router.post('/usuarios/:id/banir', rateLimit.escrita(), autorizar('usuario.banir'), validar.params(esquemas.identificador), validar(esquemas.sancao), usuarios.banir);
    router.post('/usuarios/:id/restaurar', rateLimit.escrita(), autorizar('usuario.restaurar'), validar.params(esquemas.identificador), validar(esquemas.motivo), usuarios.restaurar);
    router.post('/usuarios/:id/encerrar-sessoes', rateLimit.escrita(), autorizar('usuario.encerrar_sessoes'), validar.params(esquemas.identificador), usuarios.encerrarSessoes);

    router.get('/usuarios/:id/papeis', autorizar('rbac.ler'), validar.params(esquemas.identificador), usuarios.listarPapeis);
    router.post('/usuarios/:id/papeis', rateLimit.escrita(), autorizar('rbac.atribuir_papel'), validar.params(esquemas.identificador), validar(esquemas.papel), usuarios.atribuirPapel);
    router.delete('/usuarios/:id/papeis/:papel', rateLimit.escrita(), autorizar('rbac.atribuir_papel'), validar.params(esquemas.identificadorPapel), usuarios.removerPapel);

    router.post('/usuarios/lote/sancionar', rateLimit.escrita(), autorizar('usuario.suspender'), validar(esquemas.loteSancao), usuarios.sancionarEmLote);

    router.get('/perfis', autorizar('perfil.ler'), validar.query(esquemas.listarPerfis), usuarios.listarPerfis);
    router.post('/perfis/:id/verificar', rateLimit.escrita(), autorizar('perfil.verificar'), validar.params(esquemas.identificador), validar(esquemas.verificacao), usuarios.verificarPerfil);
    router.delete('/perfis/:id/verificar', rateLimit.escrita(), autorizar('perfil.verificar'), validar.params(esquemas.identificador), validar(esquemas.motivo), usuarios.revogarVerificacao);

    return { router, oficial: false, motivo: erro.message };
  }
}

const resultados = { ok: 0, falhas: 0 };
const ok = (nome, cond, extra) => {
  resultados[cond ? 'ok' : 'falhas'] += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

(async () => {
  await limparLimites();

  servidorAuth = app.listen(0);
  baseAuth = 'http://127.0.0.1:' + servidorAuth.address().port + '/api/v1/auth';

  const { router, oficial, motivo } = montarAdmin();
  console.log(oficial ? '\n(roteador oficial de admin)' : `\n(roteador local — admin.routes.js ainda não carrega)`);
  if (!oficial && !motivo.includes('Cannot find module')) console.log('  motivo:', motivo);

  const appAdmin = express();
  appAdmin.use(express.json());
  appAdmin.use(middlewares.contexto);
  appAdmin.use('/api/v1/admin', router);
  appAdmin.use(middlewares.erro);

  servidorAdmin = appAdmin.listen(0);
  baseAdmin = 'http://127.0.0.1:' + servidorAdmin.address().port + '/api/v1/admin';

  const alvo = await criarConta('alvo');
  const alvo2 = await criarConta('alvo2');
  const comum = await criarConta('comum');
  const contaAdmin = await comPapel(await criarConta('admin'), 'admin');
  const moderador = await comPapel(await criarConta('moderador'), 'moderador');

  console.log('\n— listagem —');
  let r = await admin('GET', '/usuarios', null, comum.token);
  ok('usuário comum não lista → 403', r.status === 403, r.corpo);

  const acessosAntes = await contarAcessos(contaAdmin.id);
  r = await admin('GET', `/usuarios?busca=${encodeURIComponent(alvo.email)}`, null, contaAdmin.token);
  ok('admin lista → 200', r.status === 200, r.corpo);
  ok('encontra pelo e-mail', (r.corpo?.dados || []).some((linha) => linha.id === alvo.id), r.corpo?.dados);
  ok('linha traz o perfil sem N+1', r.corpo?.dados?.[0]?.perfil?.tipo === 'loja', r.corpo?.dados?.[0]);
  ok('nunca vaza senha_hash', !JSON.stringify(r.corpo).includes('senha_hash'));
  ok(
    'listagem grava logs_acesso_dado',
    (await contarAcessos(contaAdmin.id)) > acessosAntes,
    { antes: acessosAntes }
  );

  r = await admin('GET', `/usuarios?busca=${alvo.documento}`, null, contaAdmin.token);
  ok('busca por documento encontra a conta', (r.corpo?.dados || []).some((l) => l.id === alvo.id), r.corpo?.dados);
  ok('documento sai só para quem pode', r.corpo?.dados?.[0]?.perfil?.documento === alvo.documento, r.corpo?.dados?.[0]?.perfil);

  r = await admin('GET', '/usuarios?porPagina=9999', null, contaAdmin.token);
  ok('porPagina acima do teto → 422', r.status === 422, r.corpo);

  r = await admin('GET', '/usuarios?tipoPerfil=produtor&uf=MT', null, contaAdmin.token);
  ok('filtro por tipo de perfil e UF → 200', r.status === 200, r.corpo);

  console.log('\n— ficha —');
  const acessosFicha = await contarAcessos(contaAdmin.id, alvo.id);
  r = await admin('GET', `/usuarios/${alvo.id}`, null, contaAdmin.token);
  ok('ficha → 200', r.status === 200, r.corpo);
  ok('ficha traz contadores agregados', typeof r.corpo?.dados?.contadores?.anuncios === 'number', r.corpo?.dados);
  ok(
    'abrir ficha alheia grava logs_acesso_dado',
    (await contarAcessos(contaAdmin.id, alvo.id)) > acessosFicha,
    { antes: acessosFicha }
  );

  r = await admin('GET', `/usuarios/${crypto.randomUUID()}`, null, contaAdmin.token);
  ok('ficha inexistente → 404', r.status === 404, r.corpo);

  r = await admin('GET', `/usuarios/${alvo.id}/atividade`, null, contaAdmin.token);
  ok('atividade da conta → 200 paginado', r.status === 200 && Array.isArray(r.corpo?.dados), r.corpo);

  console.log('\n— edição —');
  const auditoriaAntesEdicao = await contarAuditoria(contaAdmin.id, 'editar');
  r = await admin('PATCH', `/usuarios/${alvo.id}`, { nome: 'Nome Corrigido Pelo Suporte' }, contaAdmin.token);
  ok('edição → 200', r.status === 200, r.corpo);
  ok('nome atualizado', r.corpo?.dados?.nome === 'Nome Corrigido Pelo Suporte', r.corpo?.dados);
  ok(
    'edição grava logs_auditoria',
    (await contarAuditoria(contaAdmin.id, 'editar')) > auditoriaAntesEdicao,
    { antes: auditoriaAntesEdicao }
  );

  r = await admin('PATCH', `/usuarios/${alvo.id}`, { observacaoInterna: 'Cliente ligou sobre cobrança.' }, contaAdmin.token);
  ok('anotação interna → 200', r.status === 200, r.corpo);
  ok('anotação interna não vaza na resposta', !JSON.stringify(r.corpo).includes('cobrança'), r.corpo?.dados);

  console.log('\n— sanções —');
  r = await admin('POST', `/usuarios/${alvo.id}/suspender`, {}, contaAdmin.token);
  ok('suspender sem motivo → 422', r.status === 422, r.corpo);

  r = await admin('POST', `/usuarios/${alvo.id}/suspender`, { motivo: 'ok' }, contaAdmin.token);
  ok('motivo curto demais → 422', r.status === 422, r.corpo);

  r = await admin('POST', `/usuarios/${contaAdmin.id}/suspender`, { motivo: 'testando auto-sanção' }, contaAdmin.token);
  ok('auto-sanção bloqueada → 403', r.status === 403, r.corpo);

  r = await admin('POST', `/usuarios/${contaAdmin.id}/suspender`, { motivo: 'moderador tentando derrubar admin' }, moderador.token);
  ok('moderador não sanciona admin → 403', r.status === 403, r.corpo);

  const auditoriaAntesSuspensao = await contarAuditoria(contaAdmin.id, 'suspender');
  r = await admin('POST', `/usuarios/${alvo.id}/suspender`, { motivo: 'anúncios repetidos de peça falsificada', dias: 7 }, contaAdmin.token);
  ok('suspensão com motivo → 200', r.status === 200, r.corpo);
  ok('conta fica suspensa', r.corpo?.dados?.usuario?.status === 'suspenso', r.corpo?.dados?.usuario);
  ok(
    'suspensão grava logs_auditoria',
    (await contarAuditoria(contaAdmin.id, 'suspender')) > auditoriaAntesSuspensao,
    { antes: auditoriaAntesSuspensao }
  );

  const sessoesVivas = await db.Sessao.count({ where: { usuario_id: alvo.id, revogada_em: null } });
  ok('suspensão derruba as sessões', sessoesVivas === 0, { sessoesVivas });

  r = await admin('POST', `/usuarios/${alvo.id}/restaurar`, {}, contaAdmin.token);
  ok('restaurar sem motivo → 422', r.status === 422, r.corpo);

  r = await admin('POST', `/usuarios/${alvo.id}/restaurar`, { motivo: 'recurso aceito pelo suporte' }, contaAdmin.token);
  ok('restaurar com motivo → 200', r.status === 200, r.corpo);
  ok('conta volta a ativa', r.corpo?.dados?.status === 'ativo', r.corpo?.dados);

  console.log('\n— sessões —');
  const auditoriaAntesLogout = await contarAuditoria(contaAdmin.id, 'logout');
  r = await admin('POST', `/usuarios/${alvo.id}/encerrar-sessoes`, null, contaAdmin.token);
  ok('encerrar sessões → 200', r.status === 200, r.corpo);
  ok('devolve quantas caíram', typeof r.corpo?.dados?.sessoesEncerradas === 'number', r.corpo?.dados);
  ok(
    'encerramento grava logs_auditoria',
    (await contarAuditoria(contaAdmin.id, 'logout')) > auditoriaAntesLogout,
    { antes: auditoriaAntesLogout }
  );

  console.log('\n— papéis —');
  r = await admin('GET', `/usuarios/${alvo.id}/papeis`, null, contaAdmin.token);
  ok('lista papéis → 200', r.status === 200 && Array.isArray(r.corpo?.dados), r.corpo);

  r = await admin('POST', `/usuarios/${alvo.id}/papeis`, { papel: 'moderador' }, contaAdmin.token);
  ok('atribui papel → 200', r.status === 200, r.corpo);
  ok('papel aparece na lista', (r.corpo?.dados || []).some((p) => p.chave === 'moderador'), r.corpo?.dados);

  r = await admin('POST', `/usuarios/${contaAdmin.id}/papeis`, { papel: 'admin' }, contaAdmin.token);
  ok('ninguém altera os próprios papéis → 403', r.status === 403, r.corpo);

  r = await admin('DELETE', `/usuarios/${alvo.id}/papeis/moderador`, null, contaAdmin.token);
  ok('remove papel → 200', r.status === 200, r.corpo);
  ok('papel some da lista', !(r.corpo?.dados || []).some((p) => p.chave === 'moderador'), r.corpo?.dados);

  console.log('\n— lote —');
  const muitos = Array.from({ length: 60 }, () => crypto.randomUUID());
  r = await admin('POST', '/usuarios/lote/sancionar', { ids: muitos, acao: 'suspender', motivo: 'lote acima do teto' }, contaAdmin.token);
  ok('lote acima do teto → 400', r.status === 400, r.corpo);

  const demais = Array.from({ length: 150 }, () => crypto.randomUUID());
  r = await admin('POST', '/usuarios/lote/sancionar', { ids: demais, acao: 'suspender', motivo: 'lote acima do esquema' }, contaAdmin.token);
  ok('lote acima do teto do esquema → 422', r.status === 422, r.corpo);

  r = await admin('POST', '/usuarios/lote/sancionar', { ids: [alvo2.id], acao: 'suspender' }, contaAdmin.token);
  ok('lote sem motivo → 422', r.status === 422, r.corpo);

  r = await admin('POST', '/usuarios/lote/sancionar', { ids: [alvo2.id, contaAdmin.id], acao: 'suspender', motivo: 'incluindo a si mesmo' }, contaAdmin.token);
  ok('lote com a própria conta → 403', r.status === 403, r.corpo);

  r = await admin('POST', '/usuarios/lote/sancionar', { ids: [alvo2.id], acao: 'suspender', motivo: 'moderador tentando lote' }, moderador.token);
  ok('moderador não opera em lote → 403', r.status === 403, r.corpo);

  const lotesAntes = await db.LogAuditoria.count({
    where: { ator_id: contaAdmin.id, acao: 'suspender', depois: { emLote: true } },
  });
  r = await admin('POST', '/usuarios/lote/sancionar', { ids: [alvo.id, alvo2.id], acao: 'suspender', motivo: 'campanha coordenada de spam' }, contaAdmin.token);
  ok('lote válido → 200', r.status === 200, r.corpo);
  ok('duas contas afetadas', r.corpo?.dados?.aplicados === 2, r.corpo?.dados);

  const lotesDepois = await db.LogAuditoria.count({
    where: { ator_id: contaAdmin.id, acao: 'suspender', depois: { emLote: true } },
  });
  ok('UMA linha de auditoria por lote, não uma por registro', lotesDepois === lotesAntes + 1, { lotesAntes, lotesDepois });

  const suspensos = await db.Usuario.count({ where: { id: { [Op.in]: [alvo.id, alvo2.id] }, status: 'suspenso' } });
  ok('o lote aplicou de fato no banco', suspensos === 2, { suspensos });

  r = await admin('POST', '/usuarios/lote/sancionar', { ids: [alvo.id, alvo2.id], acao: 'restaurar', motivo: 'engano do time de moderação' }, contaAdmin.token);
  ok('lote de restauração → 200', r.status === 200 && r.corpo?.dados?.aplicados === 2, r.corpo);

  console.log('\n— perfis —');
  r = await admin('GET', '/perfis?verificado=false', null, contaAdmin.token);
  ok('lista perfis → 200', r.status === 200, r.corpo);
  ok('traz o dono em include', r.corpo?.dados?.[0]?.usuario !== undefined, r.corpo?.dados?.[0]);

  r = await admin('GET', '/perfis', null, comum.token);
  ok('usuário comum não lista perfis → 403', r.status === 403, r.corpo);

  const auditoriaAntesSelo = await contarAuditoria(contaAdmin.id, 'aprovar');
  r = await admin('POST', `/perfis/${alvo.perfilId}/verificar`, { observacao: 'CNPJ conferido na Receita' }, contaAdmin.token);
  ok('verificar perfil → 200', r.status === 200, r.corpo);
  ok('perfil fica verificado', r.corpo?.dados?.verificado === true, r.corpo?.dados);
  ok(
    'verificação grava logs_auditoria',
    (await contarAuditoria(contaAdmin.id, 'aprovar')) > auditoriaAntesSelo,
    { antes: auditoriaAntesSelo }
  );

  r = await admin('DELETE', `/perfis/${alvo.perfilId}/verificar`, {}, contaAdmin.token);
  ok('revogar sem motivo → 422', r.status === 422, r.corpo);

  r = await admin('DELETE', `/perfis/${alvo.perfilId}/verificar`, { motivo: 'documento apresentado não confere' }, contaAdmin.token);
  ok('revogar com motivo → 200', r.status === 200, r.corpo);
  ok('selo cai', r.corpo?.dados?.verificado === false, r.corpo?.dados);

  r = await admin('POST', `/perfis/${alvo.perfilId}/verificar`, { observacao: 'tentativa do moderador' }, moderador.token);
  ok('moderador não verifica perfil → 403', r.status === 403, r.corpo);

  console.log(`\n— total: ${resultados.ok} ok, ${resultados.falhas} falha(s) —`);

  servidorAuth.close();
  servidorAdmin.close();
  await encerrarInfra();
  await db.sequelize.close();
  process.exit(resultados.falhas ? 1 : 0);
})().catch(async (erro) => {
  console.error('\nERRO NA SUÍTE:', erro);
  try {
    servidorAuth?.close();
    servidorAdmin?.close();
    await encerrarInfra();
    await db.sequelize.close();
  } catch (_) {
    /* encerramento é melhor esforço */
  }
  process.exit(1);
});
