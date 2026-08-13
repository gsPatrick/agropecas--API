'use strict';

/**
 * Trilha de auditoria, contra a API e o banco de verdade.
 *
 *   node testes/auditoria.test.js
 *
 * O que este arquivo defende, acima de tudo: a trilha é IMUTÁVEL e não é
 * filtrável pelo auditado. Se um destes testes começar a falhar, a trilha
 * deixou de servir como prova — o problema é sério mesmo que tudo o mais
 * funcione.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const cookieParser = require('cookie-parser');
const { limparLimites, encerrarInfra } = require('./apoio');

const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');
const auditoria = require(RAIZ + '/src/features/auditoria');
const { mascarar } = require(RAIZ + '/src/features/auditoria/auditoria.mascara');
const exportacao = require(RAIZ + '/src/features/auditoria/auditoria.exportacao.service');

function montarApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use(middlewares.contexto);
  app.use('/api/v1/auth', require(RAIZ + '/src/features/auth/auth.routes'));
  app.use('/api/v1/auditoria', require(RAIZ + '/src/features/auditoria/auditoria.routes'));
  app.use((req, res) => res.status(404).json({ sucesso: false, erro: { codigo: 'ROTA_NAO_ENCONTRADA' } }));
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
  const texto = await r.text();
  let corpoResposta = null;
  try {
    corpoResposta = JSON.parse(texto);
  } catch (e) {
    corpoResposta = texto;
  }
  return { status: r.status, corpo: corpoResposta };
};

let falhas = 0;
const ok = (nome, cond, extra) => {
  if (!cond) falhas += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

const marca = Date.now();

(async () => {
  await limparLimites();
  const app = montarApp();
  server = app.listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api/v1';

  const cadastrar = async (sufixo) => {
    const email = `audit-${sufixo}-${marca}@agropecas.dev`;
    const r = await req('POST', '/auth/registrar', {
      nome: 'Auditoria ' + sufixo,
      email,
      senha: 'SenhaForte123',
      tipoPerfil: 'produtor',
      nomeExibicao: `Sitio ${sufixo} ${marca}`,
      aceiteTermos: true,
      aceitePrivacidade: true,
    });
    if (r.status !== 201) throw new Error('cadastro falhou: ' + JSON.stringify(r.corpo));
    return { email, ...r.corpo.dados };
  };

  const comum = await cadastrar('comum');
  const admin = await cadastrar('admin');

  const usuarioComum = await db.Usuario.findOne({ where: { email_normalizado: comum.email } });
  const usuarioAdmin = await db.Usuario.findOne({ where: { email_normalizado: admin.email } });

  const papelAdmin = await db.Papel.findOne({ where: { chave: 'admin' } });
  await db.UsuarioPapel.create({ usuario_id: usuarioAdmin.id, papel_id: papelAdmin.id });
  const tokenAdmin = (await req('POST', '/auth/entrar', { email: admin.email, senha: 'SenhaForte123' }))
    .corpo.dados.tokens.acesso;
  const tokenComum = comum.tokens.acesso;

  const ctxAdmin = { usuarioId: usuarioAdmin.id, papeis: ['admin'], ipHash: 'b'.repeat(64), userAgent: 'teste', origem: 'teste' };

  // ─── registro ─────────────────────────────────────────────────
  console.log('\n— registro de ações —');

  const entidadeTeste = 'teste_auditoria_' + marca;
  await auditoria.registrar(ctxAdmin, {
    acao: 'editar',
    entidade: entidadeTeste,
    entidadeId: usuarioComum.id,
    antes: { nome: 'João da Silva', documento: '12345678901', senha_hash: '$2b$10$abcdefghijklmno', status: 'ativo' },
    depois: { nome: 'João S.', documento: '98765432100', status: 'suspenso' },
    motivo: 'teste automatizado',
  });

  const linha = await db.LogAuditoria.findOne({ where: { entidade: entidadeTeste } });
  ok('gravou a ação', !!linha, 'nada gravado');
  ok('IP guardado em hash de 64 caracteres', linha.ip_hash?.length === 64, linha.ip_hash);
  ok('senha NUNCA entra na trilha, nem mascarada', linha.antes.senha_hash === '[oculto]', linha.antes);
  ok('CPF entra mascarado (dá para comparar, não para usar)', linha.antes.documento === '***8901' && !JSON.stringify(linha.antes).includes('12345678901'), linha.antes);
  ok('campo não sensível continua legível (o diff serve para algo)', linha.antes.status === 'ativo', linha.antes);

  ok('mascarar corta texto gigante', String(mascarar({ observacao: 'x'.repeat(1000) }).observacao).includes('[cortado]'));
  ok('mascarar aceita instância do Sequelize sem quebrar', mascarar(linha).acao === 'editar');

  /* falha ao auditar não pode derrubar a operação de negócio */
  const capturado = await auditoria
    .registrar(ctxAdmin, { acao: 'acao_que_nao_existe_no_enum', entidade: 'x' })
    .then(() => 'nao_lancou')
    .catch(() => 'lancou');
  ok('falha ao auditar NÃO lança (a operação continua)', capturado === 'nao_lancou', capturado);

  // ─── contrato de logs_acesso_dado ─────────────────────────────
  console.log('\n— registro de acesso a dado pessoal —');

  const gravou = await auditoria.registrarAcessoDado(ctxAdmin, {
    titularId: usuarioComum.id,
    recurso: auditoria.RECURSO_ACESSO.CADASTRO,
    recursoId: usuarioComum.id,
    motivo: 'teste do contrato reutilizável',
  });
  ok('registrarAcessoDado grava e devolve true', gravou === true, gravou);

  const acesso = await db.LogAcessoDado.findOne({
    where: { ator_id: usuarioAdmin.id, titular_id: usuarioComum.id },
    order: [['criado_em', 'DESC']],
  });
  ok('gravou ator, titular, recurso e motivo', acesso?.recurso === 'cadastro' && !!acesso.motivo, acesso?.recurso);
  ok('IP do acesso também em hash', acesso.ip_hash?.length === 64, acesso.ip_hash);

  const proprio = await auditoria.registrarAcessoDado(ctxAdmin, {
    titularId: usuarioAdmin.id,
    recurso: auditoria.RECURSO_ACESSO.CADASTRO,
  });
  ok('ler o PRÓPRIO dado não vira registro de acesso', proprio === false, proprio);

  const semRecurso = await auditoria.registrarAcessoDado(ctxAdmin, { titularId: usuarioComum.id });
  ok('chamada sem `recurso` é ignorada, não lança', semRecurso === false, semRecurso);

  const emLote = await auditoria.registrarAcessoEmLote(ctxAdmin, {
    titularIds: [usuarioComum.id, usuarioComum.id, usuarioAdmin.id, null],
    recurso: auditoria.RECURSO_ACESSO.CADASTRO,
    motivo: 'listagem',
  });
  ok('lote deduplica e remove o próprio ator', emLote === 1, emLote);

  // ─── consulta ─────────────────────────────────────────────────
  console.log('\n— consulta da trilha —');

  let r = await req('GET', '/auditoria', null, tokenComum);
  ok('usuário comum não lê a trilha → 403', r.status === 403, r.corpo);

  r = await req('GET', '/auditoria', null);
  ok('sem autenticação → 401', r.status === 401, r.corpo);

  r = await req('GET', '/auditoria?entidade=' + entidadeTeste, null, tokenAdmin);
  ok('admin consulta a trilha → 200', r.status === 200, r.corpo);
  ok('resposta é paginada e declara o período usado', !!r.corpo?.meta?.periodo && r.corpo.meta.porPagina <= 100, r.corpo?.meta);
  ok('listagem NÃO devolve ip_hash nem user_agent', !JSON.stringify(r.corpo.dados).includes('ip_hash') && !JSON.stringify(r.corpo.dados).includes('userAgent'), Object.keys(r.corpo.dados[0] || {}));

  r = await req('GET', '/auditoria?atorId=' + usuarioAdmin.id + '&entidade=' + entidadeTeste, null, tokenAdmin);
  ok('filtro POSITIVO por ator funciona (é como se descobre quem apagou)', r.status === 200 && r.corpo.dados.length >= 1, r.corpo?.dados?.length);

  r = await req('GET', '/auditoria?porPagina=100000', null, tokenAdmin);
  ok('porPagina absurdo → 422 (teto de página)', r.status === 422, r.corpo);

  r = await req('GET', '/auditoria?de=2000-01-01&ate=2030-01-01', null, tokenAdmin);
  ok('janela maior que o teto → 400', r.status === 400 && r.corpo.erro.detalhe?.code === 'JANELA_EXCEDIDA', r.corpo);

  /* VETOR DE SEGURANÇA: o admin tentando esconder as próprias linhas */
  console.log('\n— o auditado não filtra a si mesmo para fora —');

  for (const parametro of ['excluirAtor', 'excluirAtorId', 'atorIdDiferente', 'naoAtorId', 'ocultarAtor']) {
    r = await req('GET', `/auditoria?${parametro}=${usuarioAdmin.id}&entidade=${entidadeTeste}`, null, tokenAdmin);
    ok(`admin NÃO consegue filtrar as próprias linhas para fora (${parametro}) → 422`, r.status === 422, r.corpo);
  }

  r = await req('GET', '/auditoria?entidade=' + entidadeTeste, null, tokenAdmin);
  ok('e as linhas dele continuam lá depois da tentativa', r.corpo.dados.some((l) => l.ator?.id === usuarioAdmin.id), r.corpo?.dados);

  // ─── imutabilidade ────────────────────────────────────────────
  console.log('\n— a trilha é imutável —');

  const alvo = await db.LogAuditoria.findOne({ where: { entidade: entidadeTeste } });

  for (const metodo of ['PATCH', 'PUT', 'DELETE']) {
    r = await req(metodo, '/auditoria/' + alvo.id, { motivo: 'apagando meu rastro' }, tokenAdmin);
    ok(`${metodo} numa linha da trilha não existe → 404`, r.status === 404, { status: r.status, corpo: r.corpo });
  }

  r = await req('DELETE', '/auditoria', null, tokenAdmin);
  ok('DELETE na coleção inteira não existe → 404', r.status === 404, r.status);

  const rotas = require(RAIZ + '/src/features/auditoria/auditoria.routes').stack
    .filter((camada) => camada.route)
    .flatMap((camada) => Object.keys(camada.route.methods));
  ok('nenhuma rota de escrita sobre linha existente no router', !rotas.includes('patch') && !rotas.includes('put') && !rotas.includes('delete'), rotas);

  const servico = require(RAIZ + '/src/features/auditoria/auditoria.service');
  const consulta = require(RAIZ + '/src/features/auditoria/auditoria.consulta.service');
  ok('nenhum service expõe atualizar/remover', !servico.atualizar && !servico.remover && !consulta.atualizar && !consulta.remover, Object.keys({ ...servico, ...consulta }));

  const totalAntes = await db.LogAuditoria.count({ where: { entidade: entidadeTeste } });
  ok('as linhas do teste continuam íntegras', totalAntes >= 1, totalAntes);

  // ─── trilha de uma entidade ───────────────────────────────────
  console.log('\n— histórico de uma entidade —');

  r = await req('GET', `/auditoria/entidades/${entidadeTeste}/${usuarioComum.id}`, null, tokenAdmin);
  ok('histórico completo da entidade → 200', r.status === 200 && r.corpo.dados.length >= 1, r.corpo);
  ok('e traz o diff mascarado', r.corpo.dados[0].antes?.documento === '***8901', r.corpo.dados[0]?.antes);

  r = await req(`GET`, `/auditoria/entidades/${entidadeTeste}/${usuarioComum.id}`, null, tokenComum);
  ok('usuário comum não abre o histórico → 403', r.status === 403, r.corpo);

  const acessosDepois = await db.LogAcessoDado.count({ where: { ator_id: usuarioAdmin.id, recurso: 'trilha_auditoria' } });
  ok('consultar a trilha também deixa rastro', acessosDepois > 0, acessosDepois);

  // ─── acessos a dados ──────────────────────────────────────────
  r = await req('GET', '/auditoria/acessos-a-dados?titularId=' + usuarioComum.id, null, tokenAdmin);
  ok('relatório de quem abriu dados do titular → 200', r.status === 200 && r.corpo.dados.length >= 1, r.corpo);

  // ─── exportação ───────────────────────────────────────────────
  console.log('\n— exportação pela fila —');

  r = await req('POST', '/auditoria/exportacoes', { entidade: entidadeTeste, formato: 'csv' }, tokenAdmin);
  ok('exportação sem motivo declarado → 422', r.status === 422, r.corpo);

  r = await req('POST', '/auditoria/exportacoes', { entidade: entidadeTeste, formato: 'csv', motivo: 'auditoria externa' }, tokenComum);
  ok('usuário comum não exporta → 403', r.status === 403, r.corpo);

  r = await req('POST', '/auditoria/exportacoes', { entidade: entidadeTeste, formato: 'csv', motivo: 'auditoria externa' }, tokenAdmin);
  ok('exportação vai para a FILA → 202', r.status === 202 && r.corpo.dados.status === 'em_processamento', r.corpo);

  const pedidoExport = await db.LogAuditoria.count({ where: { entidade: 'logs_auditoria', acao: 'exportar_dados', ator_id: usuarioAdmin.id } });
  ok('o próprio pedido de exportação é auditado', pedidoExport > 0, pedidoExport);

  let blocos = 0;
  const linhasLidas = await exportacao.percorrer({ entidade: entidadeTeste }, async () => {
    blocos += 1;
  });
  ok('percorre a trilha em blocos (não carrega tudo na memória)', blocos >= 1 && linhasLidas >= 1, { blocos, linhasLidas });
  ok('CSV usa ponto e vírgula e escapa aspas', exportacao.linhaCsv({ id: 'a', motivo: 'tem "aspas"; e ponto e vírgula' }).includes('""aspas""'), exportacao.linhaCsv({ id: 'a', motivo: 'tem "aspas"; e ponto e vírgula' }));

  console.log(falhas === 0 ? '\n✅ auditoria: todos os testes passaram' : `\n❌ auditoria: ${falhas} falha(s)`);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
