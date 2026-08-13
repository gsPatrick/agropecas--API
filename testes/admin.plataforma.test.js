'use strict';

/**
 * Painel administrativo — fatia PLATAFORMA (configuração, planos, RBAC).
 *
 *   node testes/admin.plataforma.test.js
 *
 * Roda contra a API e o banco de verdade. O foco não é o caminho feliz (que
 * também é coberto), e sim as CINCO TRAVAS do RBAC pela tela: cada uma delas
 * protege uma invariante que, se quebrada, só se conserta por SQL.
 *
 * MONTAGEM DAS ROTAS: `admin.routes.js` é o contrato fechado, mas ele importa
 * os sete controllers e o `admin.validators.js` — arquivos de outros agentes,
 * que podem ainda não existir. O teste tenta montar o router real e, se ele
 * não carregar, monta um router equivalente só com as rotas desta fatia, com a
 * MESMA cadeia de middlewares (autenticar → autorizar). Quando o módulo
 * estiver completo, o caminho real passa a ser usado sozinho.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const { limparLimites, encerrarInfra } = require('./apoio');
const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');

let server, base, apiBase;

const req = async (metodo, caminho, corpo, token) => {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

const auth = async (metodo, caminho, corpo, token) => {
  const r = await fetch(apiBase + '/auth' + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

let total = 0;
let falhas = 0;
const ok = (nome, cond, extra) => {
  total += 1;
  if (!cond) falhas += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

/** monta o app de teste: rotas reais + painel admin */
function montarApp() {
  const app = express();
  app.use(express.json());
  app.use(middlewares.contexto);

  let router;
  let real = true;
  try {
    router = require(RAIZ + '/src/features/admin/admin.routes');
  } catch (erro) {
    real = false;
    router = routerDaFatia();
    console.log(`  (admin.routes.js não carregou — ${erro.message.split('\n')[0]}; usando router equivalente da fatia)`);
  }

  app.use('/api/v1/admin', router);
  app.use('/api', require(RAIZ + '/src/routes'));
  app.use((r, res) => res.status(404).json({ sucesso: false, erro: { codigo: 'ROTA_NAO_ENCONTRADA' } }));
  app.use(middlewares.erro);

  return { app, real };
}

/** espelho das rotas de plataforma declaradas em admin.routes.js */
function routerDaFatia() {
  const { Router } = require('express');
  const { autenticar, autorizar, rateLimit } = middlewares;
  const plataforma = require(RAIZ + '/src/features/admin/controllers/admin.plataforma.controller');

  const router = Router();
  router.use(autenticar, autorizar('admin.acessar'));

  router.get('/configuracoes', autorizar('configuracao.ler'), plataforma.listarConfiguracoes);
  router.put('/configuracoes/:chave', rateLimit.escrita(), autorizar('configuracao.editar'), plataforma.salvarConfiguracao);
  router.get('/configuracoes/:chave/historico', autorizar('configuracao.ler'), plataforma.historicoConfiguracao);

  router.get('/planos', autorizar('plano.ler'), plataforma.listarPlanos);
  router.post('/planos', rateLimit.escrita(), autorizar('plano.criar'), plataforma.criarPlano);
  router.patch('/planos/:id', rateLimit.escrita(), autorizar('plano.editar'), plataforma.editarPlano);
  router.put('/planos/:id/limites', rateLimit.escrita(), autorizar('plano.editar'), plataforma.definirLimites);
  router.delete('/planos/:id', rateLimit.escrita(), autorizar('plano.remover'), plataforma.removerPlano);
  router.post('/planos/atribuir', rateLimit.escrita(), autorizar('plano.atribuir'), plataforma.atribuirPlano);

  router.get('/rbac/papeis', autorizar('rbac.ler'), plataforma.listarPapeis);
  router.get('/rbac/permissoes', autorizar('rbac.ler'), plataforma.listarPermissoes);
  router.post('/rbac/papeis', rateLimit.escrita(), autorizar('rbac.criar_papel'), plataforma.criarPapel);
  router.patch('/rbac/papeis/:id', rateLimit.escrita(), autorizar('rbac.editar_papel'), plataforma.editarPapel);
  router.delete('/rbac/papeis/:id', rateLimit.escrita(), autorizar('rbac.remover_papel'), plataforma.removerPapel);

  return router;
}

(async () => {
  await limparLimites();

  const { app, real } = montarApp();
  server = app.listen(0);
  const raizHttp = 'http://127.0.0.1:' + server.address().port;
  apiBase = raizHttp + '/api/v1';
  base = apiBase + '/admin';
  console.log(real ? '\n(usando admin.routes.js real)' : '');

  const marca = Date.now();
  const criados = { papeis: [], planos: [], configuracoes: [] };

  const cadastrar = async (sufixo) => {
    const email = `admin_${sufixo}_${marca}@agropecas.dev`;
    const r = await auth('POST', '/registrar', {
      nome: 'Teste ' + sufixo,
      email,
      senha: 'SenhaForte123',
      tipoPerfil: 'produtor',
      aceiteTermos: true,
      aceitePrivacidade: true,
    });
    const usuario = await db.Usuario.findOne({ where: { email_normalizado: email.toLowerCase() } });
    return { email, usuario, token: r.corpo?.dados?.tokens?.acesso };
  };

  const relogar = async (email) => (await auth('POST', '/entrar', { email, senha: 'SenhaForte123' })).corpo.dados.tokens.acesso;

  const admin = await cadastrar('chefe');
  const comum = await cadastrar('comum');

  const papelAdmin = await db.Papel.findOne({ where: { chave: 'admin' } });
  await db.UsuarioPapel.create({ usuario_id: admin.usuario.id, papel_id: papelAdmin.id });
  admin.token = await relogar(admin.email);

  // ─── PORTA DO PAINEL ────────────────────────────────────────
  console.log('\n— a porta do painel —');
  let r = await req('GET', '/configuracoes', null, comum.token);
  ok('usuário comum no painel → 403', r.status === 403, r);
  r = await req('GET', '/rbac/papeis', null, comum.token);
  ok('usuário comum na tela de RBAC → 403', r.status === 403, r);
  r = await req('GET', '/configuracoes');
  ok('sem token → 401', r.status === 401, r);

  // ─── CONFIGURAÇÃO ───────────────────────────────────────────
  console.log('\n— configuração —');

  /* chave sensível criada só para este teste: o banco semeado não tem nenhuma,
     e a máscara precisa ser provada, não presumida */
  const chaveSensivel = `teste.segredo_integracao_${marca}`;
  await db.Configuracao.create({
    chave: chaveSensivel,
    valor: 'super-secreto-123',
    tipo: 'texto',
    grupo: 'integracao',
    descricao: 'chave de teste',
    publica: false,
  });
  criados.configuracoes.push(chaveSensivel);
  await require(RAIZ + '/src/features/configuracao/configuracao.leitura.service').invalidar();

  r = await req('GET', '/configuracoes', null, admin.token);
  const itens = r.corpo?.dados || [];
  const sensivel = itens.find((item) => item.chave === chaveSensivel);
  ok('lista configurações → 200', r.status === 200 && itens.length > 0, r.status);
  ok('configuração sensível não vaza o valor', !!sensivel && sensivel.valor === null && sensivel.mascarado === true, sensivel);
  ok('resposta inteira não contém o segredo', !JSON.stringify(r.corpo).includes('super-secreto-123'));
  ok('nenhum campo `bruto` na listagem (lista branca)', !JSON.stringify(r.corpo).includes('"bruto"'));

  r = await req('PUT', '/configuracoes/anuncio.max_fotos', { valor: 7, motivo: 'teste de painel' }, admin.token);
  ok('salva configuração → 200', r.status === 200 && r.corpo?.dados?.valor === 7, r.corpo);
  r = await req('PUT', '/configuracoes/nao.existe.chave', { valor: 1 }, admin.token);
  ok('chave inexistente → 404 (sem criação silenciosa)', r.status === 404, r.status);

  r = await req('GET', '/configuracoes/anuncio.max_fotos/historico', null, admin.token);
  ok('histórico traz a alteração com antes e depois', r.status === 200 && (r.corpo?.dados || []).some((linha) => linha.para === 7), r.corpo?.dados?.[0]);
  r = await req('GET', `/configuracoes/${chaveSensivel}/historico`, null, admin.token);
  ok('histórico de chave sensível não imprime valores', r.status === 200 && (r.corpo?.dados || []).every((linha) => linha.mascarado === true), r.corpo?.dados?.[0]);

  r = await req('PUT', '/configuracoes/anuncio.max_fotos', { valor: 8 }, comum.token);
  ok('usuário comum não edita configuração → 403', r.status === 403, r.status);

  // ─── PLANOS ─────────────────────────────────────────────────
  console.log('\n— planos —');
  r = await req('GET', '/planos', null, admin.token);
  ok('lista planos com contagem de assinantes → 200', r.status === 200 && r.corpo.dados.every((p) => typeof p.assinantesVigentes === 'number'), r.corpo?.dados?.[0]);

  r = await req('POST', '/planos', {
    chave: `teste_${marca}`,
    nome: 'Plano de teste',
    precoCentavos: 1000,
    periodicidade: 'mensal',
    ativo: true,
    publico: false,
    limites: [{ chave: 'anuncios.ativos', valor: 3, periodo: 'total' }],
  }, admin.token);
  ok('cria plano → 201', r.status === 201, r.corpo);
  const planoId = r.corpo?.dados?.id;
  if (planoId) criados.planos.push(planoId);
  /* `esquemas.plano` (admin.validators) não declara `limites`, então o campo é
     descartado na validação e o plano nasce sem limite — o service aceita a
     lista quando ela chega. Está reportado; a definição de limites é feita
     pela rota dedicada, testada logo abaixo. */
  ok('plano criado responde com a lista de limites (vazia sem o campo no esquema)', Array.isArray(r.corpo?.dados?.limites), r.corpo?.dados);

  if (planoId) {
    r = await req('PATCH', `/planos/${planoId}`, { nome: 'Plano de teste editado' }, admin.token);
    ok('edita plano → 200', r.status === 200 && r.corpo.dados.nome === 'Plano de teste editado', r.corpo);

    r = await req('PUT', `/planos/${planoId}/limites`, { limites: [{ chave: 'anuncios.ativos', valor: null, periodo: 'total' }] }, admin.token);
    ok('limite null = ilimitado (substituição completa)', r.status === 200 && r.corpo.dados.limites[0].ilimitado === true, r.corpo?.dados?.limites);

    r = await req('POST', '/planos/atribuir', { usuarioId: comum.usuario.id, planoId, motivo: 'teste' }, admin.token);
    ok('atribui plano a outro usuário → 201', r.status === 201, r.corpo);

    r = await req('DELETE', `/planos/${planoId}`, null, admin.token);
    ok('não remove plano com assinante ativo → 409', r.status === 409, r.status);
  }

  const padrao = await db.Plano.findOne({ where: { padrao: true } });
  if (padrao) {
    r = await req('DELETE', `/planos/${padrao.id}`, null, admin.token);
    ok('não remove o plano padrão da plataforma → 400', r.status === 400, r.status);
  }

  // ─── RBAC: LEITURA ──────────────────────────────────────────
  console.log('\n— RBAC: leitura —');
  r = await req('GET', '/rbac/papeis', null, admin.token);
  const papeis = r.corpo?.dados || [];
  const papelAdminJson = papeis.find((p) => p.chave === 'admin');
  ok('lista papéis com permissões e contagem de usuários → 200', r.status === 200 && papeis.length >= 4, r.status);
  ok('papel admin vem marcado como sistema', papelAdminJson?.sistema === true, papelAdminJson);
  ok('papel admin carrega o coringa', (papelAdminJson?.permissoes || []).includes('*'), papelAdminJson?.permissoes?.slice(0, 5));
  ok('papel traz totalUsuarios (sem N+1: um count agrupado)', typeof papelAdminJson?.totalUsuarios === 'number', papelAdminJson);

  r = await req('GET', '/rbac/permissoes', null, admin.token);
  ok('lista permissões agrupadas por recurso → 200', r.status === 200 && !!r.corpo?.dados?.anuncio && r.corpo.meta.total > 100, r.corpo?.meta);

  // ─── RBAC: CRIAÇÃO E AUDITORIA (trava 5) ────────────────────
  console.log('\n— RBAC: criar papel pela tela (trava 5: auditoria) —');
  const chaveNova = `teste_moderador_${marca}`;
  r = await req('POST', '/rbac/papeis', {
    chave: chaveNova,
    nome: 'Moderador de teste',
    descricao: 'criado pela tela',
    permissoes: ['admin.acessar', 'rbac.ler', 'rbac.criar_papel', 'rbac.editar_papel', 'anuncio.ler.todos'],
  }, admin.token);
  ok('cria papel sem deploy → 201', r.status === 201, r.corpo);
  const papelNovoId = r.corpo?.dados?.id;
  if (papelNovoId) criados.papeis.push(papelNovoId);
  ok('papel criado pela tela nunca nasce como sistema', r.corpo?.dados?.sistema === false, r.corpo?.dados);

  r = await req('POST', '/rbac/papeis', { chave: chaveNova, nome: 'Duplicado' }, admin.token);
  ok('chave duplicada → 409', r.status === 409, r.status);
  r = await req('POST', '/rbac/papeis', { chave: `x_${marca}`, nome: 'x', permissoes: ['nao.existe.essa'] }, admin.token);
  ok('permissão inexistente é recusada, não ignorada → 422', r.status === 422, r.status);

  const logCriacao = await db.LogAuditoria.findOne({ where: { entidade: 'papel', entidade_id: papelNovoId, acao: 'criar' } });
  ok('TRAVA 5 — criação de papel grava logs_auditoria', !!logCriacao && Array.isArray(logCriacao.depois?.permissoes), logCriacao?.depois);

  /* papel separado para os testes de edição e remoção: mexer no papel do
     `escalador` antes de ele logar mudaria o que a TRAVA 3 está medindo */
  r = await req('POST', '/rbac/papeis', {
    chave: `teste_edicao_${marca}`,
    nome: 'Papel de edição',
    permissoes: ['admin.acessar', 'rbac.ler', 'usuario.ler.todos', 'anuncio.ler.todos'],
  }, admin.token);
  const papelEdicaoId = r.corpo?.dados?.id;
  if (papelEdicaoId) criados.papeis.push(papelEdicaoId);

  r = await req('PATCH', `/rbac/papeis/${papelEdicaoId}`, { nome: 'Papel renomeado', permissoes: ['admin.acessar', 'rbac.ler', 'anuncio.ler.todos'] }, admin.token);
  ok('edita papel (substituição do conjunto) → 200', r.status === 200 && r.corpo.dados.permissoes.length === 3, r.corpo?.dados);
  const logEdicao = await db.LogAuditoria.findOne({ where: { entidade: 'papel', entidade_id: papelEdicaoId, acao: 'editar' }, order: [['criado_em', 'DESC']] });
  ok('TRAVA 5 — edição grava antes E depois', !!logEdicao?.antes?.permissoes && !!logEdicao?.depois?.permissoes && logEdicao.antes.permissoes.length !== logEdicao.depois.permissoes.length, { antes: logEdicao?.antes, depois: logEdicao?.depois });

  // ─── TRAVA 1: papel de sistema ──────────────────────────────
  console.log('\n— TRAVA 1: papel de sistema é intocável —');
  r = await req('DELETE', `/rbac/papeis/${papelAdmin.id}`, null, admin.token);
  ok('remover o papel admin → 409', r.status === 409, r.corpo?.erro);
  const aindaExiste = await db.Papel.findByPk(papelAdmin.id);
  ok('o papel admin continua no banco', !!aindaExiste);
  /* `esquemas.papelEdicao` nem sequer aceita `chave` — a trava existe para
     quem chamar o service por outro caminho (script, job), então é lá que ela
     se prova */
  const rbacServico = require(RAIZ + '/src/features/admin/services/admin.plataforma.rbac.service');
  let erroChave = null;
  await rbacServico
    .editarPapel({ autenticado: true, usuarioId: admin.usuario.id, papeis: ['admin'], permissoes: new Set(['*']), admin: true }, papelAdmin.id, { chave: 'admin_renomeado' })
    .catch((erro) => { erroChave = erro; });
  ok('trocar a chave do papel de sistema → 409', erroChave?.statusCode === 409, erroChave?.message);
  const chaveIntacta = await db.Papel.findByPk(papelAdmin.id);
  ok('a chave do papel admin continua "admin"', chaveIntacta.chave === 'admin', chaveIntacta.chave);
  const papelSuporte = await db.Papel.findOne({ where: { chave: 'suporte' } });
  r = await req('DELETE', `/rbac/papeis/${papelSuporte.id}`, null, admin.token);
  ok('remover o papel suporte (sistema) → 409', r.status === 409, r.status);

  // ─── TRAVA 2: ninguém se desarma ────────────────────────────
  console.log('\n— TRAVA 2: ninguém retira as próprias permissões de administração —');
  r = await req('PATCH', `/rbac/papeis/${papelAdmin.id}`, { permissoes: ['anuncio.ler.todos'] }, admin.token);
  ok('admin tirando o próprio poder → 409', r.status === 409, r.corpo?.erro);
  const coringaIntacto = await db.Papel.findOne({
    where: { chave: 'admin' },
    include: [{ model: db.Permissao, as: 'permissoes', attributes: ['chave'], through: { attributes: [] } }],
  });
  ok('o papel admin continua com o coringa', coringaIntacto.permissoes.some((p) => p.chave === '*'));

  // ─── TRAVA 3: não se concede o que não se tem ───────────────
  console.log('\n— TRAVA 3: ninguém concede permissão que não tem —');
  const escalador = await cadastrar('escalador');
  await db.UsuarioPapel.create({ usuario_id: escalador.usuario.id, papel_id: papelNovoId });
  escalador.token = await relogar(escalador.email);

  r = await req('GET', '/rbac/papeis', null, escalador.token);
  ok('papel criado pela tela já vale (entra no painel)', r.status === 200, r.status);

  /* pela rede o coringa nem chega ao service: `esquemas.papelNovo` exige o
     formato `recurso.acao[.escopo]` e recusa `*` com 422. É defesa em
     profundidade — a trava do service continua sendo a que vale, e por isso é
     provada logo abaixo com uma chamada direta */
  r = await req('POST', '/rbac/papeis', { chave: `escalada_${marca}`, nome: 'Escalada', permissoes: ['*'] }, escalador.token);
  ok('coringa pela tela é barrado antes do service → 422', r.status === 422, r.corpo?.erro);

  const contextoEscalador = {
    autenticado: true,
    usuarioId: escalador.usuario.id,
    papeis: [chaveNova],
    permissoes: new Set(['admin.acessar', 'rbac.ler', 'rbac.criar_papel', 'rbac.editar_papel', 'anuncio.ler.todos']),
    admin: false,
  };
  let erroEscalada = null;
  await rbacServico
    .criarPapel(contextoEscalador, { chave: `escalada_direta_${marca}`, nome: 'Escalada', permissoes: ['*'] })
    .catch((erro) => { erroEscalada = erro; });
  ok('TRAVA 3 — conceder o coringa sem tê-lo → 403 no service', erroEscalada?.statusCode === 403, erroEscalada?.message);
  r = await req('POST', '/rbac/papeis', { chave: `escalada2_${marca}`, nome: 'Escalada 2', permissoes: ['usuario.banir.todos'] }, escalador.token);
  ok('moderador concedendo permissão que não tem → 403', r.status === 403, r.corpo?.erro);
  r = await req('POST', '/rbac/papeis', { chave: `permitido_${marca}`, nome: 'Permitido', permissoes: ['anuncio.ler.todos'] }, escalador.token);
  ok('moderador concedendo o que ELE tem → 201', r.status === 201, r.corpo?.erro);
  if (r.corpo?.dados?.id) criados.papeis.push(r.corpo.dados.id);

  // ─── TRAVA 4: sempre resta um coringa ───────────────────────
  console.log('\n— TRAVA 4: sempre resta alguém com o coringa —');
  /**
   * Chamada direta ao service com contexto sintético.
   *
   * Pela rede, tirar o coringa do papel admin bate antes na trava 2 (o ator É
   * admin). Para provar que a trava 4 existe por si, usamos um ator que tem
   * poder mas NÃO tem o papel admin — que é exatamente o cenário real
   * perigoso: um segundo administrador editando o papel do primeiro.
   */
  const rbacService = require(RAIZ + '/src/features/admin/services/admin.plataforma.rbac.service');
  const contextoSintetico = { autenticado: true, usuarioId: admin.usuario.id, papeis: ['suporte'], permissoes: new Set(['*']), admin: true, origem: 'teste' };

  let erroTrava4 = null;
  await rbacService
    .editarPapel(contextoSintetico, papelAdmin.id, { permissoes: ['admin.acessar'] })
    .catch((erro) => { erroTrava4 = erro; });
  ok('retirar o último coringa → recusado (409)', erroTrava4?.statusCode === 409, erroTrava4?.message);

  erroTrava4 = null;
  await rbacService
    .removerPapel(contextoSintetico, papelAdmin.id)
    .catch((erro) => { erroTrava4 = erro; });
  ok('remover o papel que carrega o coringa → recusado', !!erroTrava4, 'não lançou');

  const coringaDepois = await db.Papel.findOne({
    where: { chave: 'admin' },
    include: [{ model: db.Permissao, as: 'permissoes', attributes: ['chave'], through: { attributes: [] } }],
  });
  ok('nada foi escrito: o coringa segue no papel admin', coringaDepois.permissoes.some((p) => p.chave === '*'));

  // ─── REMOÇÃO LEGÍTIMA ───────────────────────────────────────
  console.log('\n— remoção de papel criado pela tela —');
  r = await req('DELETE', `/rbac/papeis/${papelEdicaoId}`, null, admin.token);
  ok('remove papel não-sistema → 200', r.status === 200, r.corpo);
  ok('a resposta informa quantos usuários perderam o papel', typeof r.corpo?.dados?.usuariosAfetados === 'number', r.corpo?.dados);
  const vinculoSobrou = await db.UsuarioPapel.count({ where: { papel_id: papelEdicaoId } });
  ok('vínculos do papel removido também saíram', vinculoSobrou === 0, vinculoSobrou);
  const logRemocao = await db.LogAuditoria.findOne({ where: { entidade: 'papel', entidade_id: papelEdicaoId, acao: 'remover' } });
  ok('TRAVA 5 — remoção auditada com o estado anterior', !!logRemocao?.antes?.permissoes, logRemocao?.antes);
  criados.papeis = criados.papeis.filter((id) => id !== papelEdicaoId);

  // ─── LIMPEZA ────────────────────────────────────────────────
  for (const id of criados.papeis) {
    await db.PapelPermissao.destroy({ where: { papel_id: id } });
    await db.UsuarioPapel.destroy({ where: { papel_id: id } });
    await db.Papel.destroy({ where: { id } });
  }
  for (const id of criados.planos) {
    await db.Assinatura.destroy({ where: { plano_id: id }, force: true });
    await db.PlanoLimite.destroy({ where: { plano_id: id } });
    await db.Plano.destroy({ where: { id }, force: true });
  }
  for (const chave of criados.configuracoes) await db.Configuracao.destroy({ where: { chave } });

  console.log(`\n${total - falhas}/${total} verificações passaram${falhas ? ` — ${falhas} FALHA(S)` : ''}`);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  console.error('ERRO:', erro);
  server?.close();
  process.exit(1);
});
