'use strict';

/**
 * Painel administrativo — fatia CONFORMIDADE (LGPD, auditoria, relatórios).
 *
 *   node testes/admin.conformidade.test.js
 *
 * O que esta suíte precisa provar, além do caminho feliz:
 *
 *   - a trilha é IMUTÁVEL: não há verbo de escrita, nem para o Admin;
 *   - o Admin não consegue filtrar as próprias linhas para fora;
 *   - exportação vai para a FILA (202 + protocolo), nunca no corpo da resposta,
 *     e tem cota própria — é a operação mais cara do painel;
 *   - o prazo legal de 15 dias aparece na fila do encarregado;
 *   - usuário comum não entra.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const { limparLimites, encerrarInfra } = require('./apoio');
const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');

let server, base, apiBase;

const chamar = async (url, metodo, corpo, token) => {
  const r = await fetch(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

const req = (metodo, caminho, corpo, token) => chamar(base + caminho, metodo, corpo, token);
const auth = (metodo, caminho, corpo, token) => chamar(apiBase + '/auth' + caminho, metodo, corpo, token);

let total = 0;
let falhas = 0;
const ok = (nome, cond, extra) => {
  total += 1;
  if (!cond) falhas += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

/** espelho das rotas de conformidade, usado só se `admin.routes.js` não carregar */
function routerDaFatia() {
  const { Router } = require('express');
  const { autenticar, autorizar, rateLimit } = middlewares;
  const conformidade = require(RAIZ + '/src/features/admin/controllers/admin.conformidade.controller');

  const router = Router();
  router.use(autenticar, autorizar('admin.acessar'));

  router.get('/lgpd/solicitacoes', autorizar('lgpd.ler_solicitacoes'), conformidade.listarSolicitacoes);
  router.get('/lgpd/solicitacoes/:id', autorizar('lgpd.ler_solicitacoes'), conformidade.verSolicitacao);
  router.post('/lgpd/solicitacoes/:id/responder', rateLimit.escrita(), autorizar('lgpd.responder_solicitacao'), conformidade.responderSolicitacao);
  router.get('/lgpd/documentos', autorizar('lgpd.publicar_documento'), conformidade.listarDocumentos);
  router.post('/lgpd/documentos', rateLimit.escrita(), autorizar('lgpd.publicar_documento'), conformidade.publicarDocumento);

  router.get('/auditoria', autorizar('auditoria.ler'), conformidade.trilha);
  router.get('/auditoria/acessos-a-dados', autorizar('auditoria.ler'), conformidade.acessosADados);
  router.post('/auditoria/exportar', rateLimit.escrita(), autorizar('auditoria.exportar'), conformidade.exportarTrilha);

  router.get('/relatorios', autorizar('relatorio.ler'), conformidade.relatorios);
  router.post('/relatorios/exportar', rateLimit.escrita(), autorizar('relatorio.exportar'), conformidade.exportarRelatorio);

  return router;
}

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

const dia = (deslocamento) => new Date(Date.now() + deslocamento * 86400000).toISOString().slice(0, 10);

(async () => {
  await limparLimites();

  const { app, real } = montarApp();
  server = app.listen(0);
  const raizHttp = 'http://127.0.0.1:' + server.address().port;
  apiBase = raizHttp + '/api/v1';
  base = apiBase + '/admin';
  console.log(real ? '\n(usando admin.routes.js real)' : '');

  const marca = Date.now();
  const limpar = { documentos: [], solicitacoes: [], vigenciaRestaurar: [] };

  const cadastrar = async (sufixo) => {
    const email = `conf_${sufixo}_${marca}@agropecas.dev`;
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

  const admin = await cadastrar('dpo');
  const comum = await cadastrar('titular');

  const papelAdmin = await db.Papel.findOne({ where: { chave: 'admin' } });
  await db.UsuarioPapel.create({ usuario_id: admin.usuario.id, papel_id: papelAdmin.id });
  admin.token = (await auth('POST', '/entrar', { email: admin.email, senha: 'SenhaForte123' })).corpo.dados.tokens.acesso;

  // ─── PORTA ──────────────────────────────────────────────────
  console.log('\n— a porta —');
  let r = await req('GET', '/lgpd/solicitacoes', null, comum.token);
  ok('usuário comum na fila do encarregado → 403', r.status === 403, r.status);
  r = await req('GET', '/auditoria', null, comum.token);
  ok('usuário comum na trilha → 403', r.status === 403, r.status);
  r = await req('GET', '/relatorios?de=' + dia(-7) + '&ate=' + dia(0), null, comum.token);
  ok('usuário comum nos relatórios → 403', r.status === 403, r.status);

  // ─── SOLICITAÇÕES DO TITULAR ────────────────────────────────
  console.log('\n— solicitações do titular (prazo de 15 dias) —');

  /* uma solicitação de verdade, aberta pelo titular pela rota pública da
     feature: o painel precisa enxergar o que o usuário criou, não um registro
     fabricado direto no banco */
  const abertura = await chamar(apiBase + '/lgpd/solicitacoes', 'POST', { tipo: 'acesso', descricao: 'quero saber o que vocês guardam sobre mim' }, comum.token);
  const solicitacaoId = abertura.corpo?.dados?.id;
  if (solicitacaoId) limpar.solicitacoes.push(solicitacaoId);
  ok('titular abre solicitação pela feature → 201', abertura.status === 201, abertura.corpo);

  r = await req('GET', '/lgpd/solicitacoes', null, admin.token);
  ok('fila do encarregado → 200', r.status === 200, r.status);
  ok('a fila traz o prazo legal de 15 dias', r.corpo?.meta?.resumo?.prazoDias === 15, r.corpo?.meta?.resumo);
  ok('a fila traz os contadores (abertas/vencendo/atrasadas)', ['abertas', 'vencendo', 'atrasadas'].every((c) => typeof r.corpo?.meta?.resumo?.[c] === 'number'), r.corpo?.meta?.resumo);
  ok('a solicitação recém-aberta aparece na fila', (r.corpo?.dados || []).some((item) => item.id === solicitacaoId), (r.corpo?.dados || []).length);
  const naFila = (r.corpo?.dados || []).find((item) => item.id === solicitacaoId);
  ok('cada linha diz quantos dias restam', typeof naFila?.diasRestantes === 'number' && naFila.diasRestantes <= 15, naFila);
  ok('listagem não expõe e-mail do solicitante (lista branca)', naFila && naFila.emailSolicitante === undefined, naFila);

  r = await req('GET', '/lgpd/solicitacoes/' + solicitacaoId, null, admin.token);
  ok('detalhe da solicitação → 200', r.status === 200 && r.corpo.dados.id === solicitacaoId, r.status);
  const acessoRegistrado = await db.LogAcessoDado.count({ where: { ator_id: admin.usuario.id, titular_id: comum.usuario.id } });
  ok('abrir dado de titular grava logs_acesso_dado', acessoRegistrado >= 1, acessoRegistrado);

  r = await req('POST', '/lgpd/solicitacoes/' + solicitacaoId + '/responder', { status: 'concluida', resposta: 'Segue a relação completa dos dados tratados, conforme solicitado.' }, admin.token);
  ok('responde e encerra → 200', r.status === 200 && r.corpo.dados.status === 'concluida', r.corpo);
  r = await req('POST', '/lgpd/solicitacoes/' + solicitacaoId + '/responder', { status: 'concluida', resposta: 'Resposta repetida para conferir a recusa.' }, admin.token);
  ok('solicitação encerrada não aceita nova resposta → 409', r.status === 409, r.status);

  // ─── DOCUMENTOS LEGAIS ──────────────────────────────────────
  console.log('\n— documentos legais e reaceite —');
  r = await req('GET', '/lgpd/documentos', null, admin.token);
  ok('lista documentos → 200', r.status === 200 && Array.isArray(r.corpo?.dados?.versoes), r.status);
  ok('painel expõe o número de contas que precisam reaceitar', typeof r.corpo?.meta?.totalReaceitePendente === 'number', r.corpo?.meta);

  const vigenteAntes = await db.DocumentoLegal.findOne({ where: { tipo: 'termos_de_uso', vigente_ate: null } });
  const versaoNova = `9.${String(marca).slice(-4)}`;
  r = await req('POST', '/lgpd/documentos', {
    tipo: 'termos_de_uso',
    versao: versaoNova,
    conteudo: 'Termos de uso de teste automatizado. '.repeat(4),
    resumoMudancas: 'publicação de teste',
    exigirAceite: true,
  }, admin.token);
  ok('publica nova versão → 201', r.status === 201, r.corpo?.erro);
  const documentoNovo = await db.DocumentoLegal.findOne({ where: { tipo: 'termos_de_uso', versao: versaoNova } });
  if (documentoNovo) limpar.documentos.push(documentoNovo.id);
  if (vigenteAntes) limpar.vigenciaRestaurar.push(vigenteAntes.id);
  ok('a versão anterior não é apagada, só encerrada', !!documentoNovo && (!vigenteAntes || (await db.DocumentoLegal.findByPk(vigenteAntes.id)) !== null), null);
  ok('a resposta traz o tamanho do reaceite pendente', typeof r.corpo?.meta?.reaceitePendente?.desatualizados === 'number', r.corpo?.meta);

  r = await req('POST', '/lgpd/documentos', { tipo: 'termos_de_uso', versao: versaoNova, conteudo: 'Mesma versão de novo. '.repeat(5) }, admin.token);
  ok('mesma versão publicada duas vezes → 409', r.status === 409, r.status);

  // ─── TRILHA ─────────────────────────────────────────────────
  console.log('\n— trilha de auditoria —');
  r = await req('GET', `/auditoria?de=${dia(-7)}&ate=${dia(0)}`, null, admin.token);
  ok('consulta paginada → 200', r.status === 200 && Array.isArray(r.corpo?.dados), r.status);
  ok('a resposta devolve o período aplicado', !!r.corpo?.meta?.periodo?.inicio, r.corpo?.meta);
  ok('a linha não expõe ip_hash nem user_agent', !JSON.stringify(r.corpo).includes('ip_hash') && !JSON.stringify(r.corpo).includes('user_agent'));
  const linhaTrilha = (r.corpo?.dados || [])[0];

  r = await req('GET', `/auditoria?de=${dia(-800)}&ate=${dia(0)}`, null, admin.token);
  ok('período acima do teto → 400', r.status === 400, r.status);
  r = await req('GET', `/auditoria?de=${dia(-7)}&ate=${dia(0)}&porPagina=99999`, null, admin.token);
  ok('porPagina absurdo é recusado ou limitado', r.status === 422 || (r.status === 200 && r.corpo.meta.porPagina <= 100), r.corpo?.meta);

  console.log('\n— a trilha é imutável —');
  for (const metodo of ['PATCH', 'PUT', 'DELETE']) {
    const alvo = linhaTrilha ? '/auditoria/' + linhaTrilha.id : '/auditoria/00000000-0000-4000-8000-000000000000';
    const resposta = await req(metodo, alvo, { motivo: 'apagando o meu rastro' }, admin.token);
    ok(`${metodo} numa linha da trilha → 404/405 (o verbo não existe)`, [404, 405].includes(resposta.status), resposta.status);
  }

  console.log('\n— o admin não filtra as próprias linhas para fora —');
  for (const parametro of ['excluirAtor', 'excluirAtorId', 'naoAtorId', 'ocultarAtor']) {
    const resposta = await req('GET', `/auditoria?de=${dia(-7)}&ate=${dia(0)}&${parametro}=${admin.usuario.id}`, null, admin.token);
    ok(`filtro por exclusão (${parametro}) → 422`, resposta.status === 422, resposta.status);
  }
  r = await req('GET', `/auditoria?de=${dia(-7)}&ate=${dia(0)}&atorId=${admin.usuario.id}`, null, admin.token);
  ok('filtro POSITIVO por ator continua valendo → 200', r.status === 200, r.status);

  r = await req('GET', '/auditoria/acessos-a-dados?titularId=' + comum.usuario.id, null, admin.token);
  ok('acessos a dados do titular → 200', r.status === 200 && (r.corpo?.dados || []).length >= 1, r.status);

  // ─── EXPORTAÇÕES ────────────────────────────────────────────
  console.log('\n— exportação vai para a fila —');
  r = await req('POST', '/auditoria/exportar', { de: dia(-7), ate: dia(0), formato: 'csv', motivo: 'auditoria interna de teste' }, admin.token);
  ok('exportar trilha → 202 (protocolo, não arquivo)', r.status === 202, r.corpo);
  ok('a resposta não carrega linhas da trilha', r.status !== 202 || !Array.isArray(r.corpo?.dados?.itens), r.corpo?.dados);
  ok('o pedido de exportação fica auditado', (await db.LogAuditoria.count({ where: { ator_id: admin.usuario.id, entidade: 'logs_auditoria', acao: 'exportar_dados' } })) >= 1);

  r = await req('POST', '/relatorios/exportar', { de: dia(-7), ate: dia(0), formato: 'csv', motivo: 'relatório mensal de teste' }, admin.token);
  ok('exportar relatório → 202 com protocolo', r.status === 202 && !!r.corpo?.dados?.protocolo, r.corpo);

  /* cota própria: cinco por hora e por administrador. A rota já tem
     rateLimit.escrita(), mas 30/min é generoso demais para uma varredura de
     `logs_auditoria` inteira */
  let ultimo = null;
  for (let tentativa = 0; tentativa < 6; tentativa += 1) {
    ultimo = await req('POST', '/auditoria/exportar', { de: dia(-2), ate: dia(0), formato: 'json', motivo: 'teste de cota de exportacao ' + tentativa }, admin.token);
  }
  ok('exportação em série esbarra na cota → 429', ultimo.status === 429, ultimo.status);

  // ─── RELATÓRIOS ─────────────────────────────────────────────
  console.log('\n— relatórios —');
  r = await req('GET', `/relatorios?de=${dia(-7)}&ate=${dia(0)}`, null, admin.token);
  ok('painel de números → 200', r.status === 200 && !!r.corpo?.dados?.usuarios, r.status);
  ok('painel não lista pessoas, só agregados', !JSON.stringify(r.corpo?.dados?.usuarios).includes(admin.usuario.id), null);
  r = await req('GET', '/relatorios', null, admin.token);
  ok('relatório sem período → 400', r.status === 400, r.status);

  // ─── LIMPEZA ────────────────────────────────────────────────
  for (const id of limpar.documentos) await db.DocumentoLegal.destroy({ where: { id }, force: true });
  for (const id of limpar.vigenciaRestaurar) await db.DocumentoLegal.update({ vigente_ate: null }, { where: { id } });
  for (const id of limpar.solicitacoes) await db.SolicitacaoTitular.destroy({ where: { id }, force: true });
  await require(RAIZ + '/src/features/admin/services/admin.conformidade.lgpd.service').invalidarPainel();
  await require(RAIZ + '/src/cache').invalidar(require(RAIZ + '/src/cache/chaves').chaves.dominio('lgpd'));

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
