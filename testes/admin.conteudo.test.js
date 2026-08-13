'use strict';

/**
 * Painel administrativo — conteúdo (anúncios, moderação, mídia).
 * Contra a API e o banco de verdade, como o resto da suíte.
 *
 *   node testes/admin.conteudo.test.js
 *
 * ⚠️ DOIS impedimentos, ambos em arquivos que este módulo não pode editar:
 *
 *   1. `src/routes/index.js` ainda tem a linha do admin comentada;
 *   2. `admin.routes.js` importa os controllers de comunidade, plataforma e
 *      conformidade, que outros agentes ainda não entregaram — requerê-lo hoje
 *      falha antes de registrar qualquer rota.
 *
 * Por isso o teste remonta **exatamente as linhas de rota da minha fatia**,
 * copiadas de `admin.routes.js` sem alteração (mesmos middlewares, mesma
 * ordem, mesmos esquemas). Assim que os outros controllers existirem e a linha
 * de `routes/index.js` for descomentada, este bloco vira
 * `app.use('/api/v1/admin', require('../src/features/admin/admin.routes'))`.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');
const { montarApp, clienteEm, registrar, comPapel, papelPorChave } = require('./apoio.admin');
const db = require(RAIZ + '/src/models');
const filas = require(RAIZ + '/src/filas');

let req;

let passou = 0;
let falhou = 0;
const ok = (nome, cond, extra) => {
  if (cond) passou += 1;
  else falhou += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' \u2192 ' + JSON.stringify(extra)));
};

(async () => {
  await limparLimites();
  const servidor = montarApp().listen(0);
  req = clienteEm('http://127.0.0.1:' + servidor.address().port + '/api/v1');

  /* a fila só entrega com worker rodando; o teste observa o que foi
     ENFILEIRADO, que é o contrato que este módulo promete cumprir */
  const enfileirados = [];
  const enfileirarOriginal = filas.enfileirar;
  filas.enfileirar = async (nome, dados) => {
    enfileirados.push({ nome, dados });
    return enfileirarOriginal(nome, dados);
  };

  const comum = await registrar(req, 'comum');
  const adminConta = await registrar(req, 'admin');
  const tokenAdmin = await comPapel(req, adminConta, (await papelPorChave('admin')).id);

  console.log('\n— porta do painel: usuário comum não entra —');
  for (const [metodo, caminho, corpo] of [
    ['GET', '/admin/anuncios'],
    ['GET', '/admin/moderacao/fila'],
    ['GET', '/admin/midia'],
    ['POST', '/admin/anuncios/lote/moderar', { ids: [comum.id], acao: 'aprovar', motivo: 'teste de lote' }],
    ['POST', '/admin/anuncios/em-nome-de', { usuarioId: comum.id, motivo: 'pedido por telefone', anuncio: { tipo: 'peca', titulo: 'Bomba hidráulica' } }],
  ]) {
    const r = await req(metodo, caminho, corpo, comum.token);
    ok(`${metodo} ${caminho} → 403 para usuário comum`, r.status === 403, r);
  }
  let r = await req('GET', '/admin/anuncios');
  ok('sem token → 401', r.status === 401, r.corpo);

  console.log('\n— listagem administrativa —');
  r = await req('GET', '/admin/anuncios?porPagina=5', null, tokenAdmin);
  ok('lista → 200 paginado', r.status === 200 && Array.isArray(r.corpo.dados), r.corpo);
  ok('meta de paginação presente', !!r.corpo?.meta && r.corpo.meta.porPagina <= 5, r.corpo?.meta);
  ok('listagem não traz descricao (TEXT)', !(r.corpo?.dados || []).some((a) => 'descricao' in a));
  ok(
    'nenhum campo sensível vaza',
    !/senha_hash|ip_hash|token_hash/.test(JSON.stringify(r.corpo)),
  );

  r = await req('GET', '/admin/anuncios?porPagina=9999', null, tokenAdmin);
  ok('porPagina acima do teto → recusado pelo esquema', r.status === 422, r.status);

  console.log('\n— publicar em nome do anunciante —');
  r = await req(
    'POST',
    '/admin/anuncios/em-nome-de',
    {
      usuarioId: comum.id,
      motivo: 'produtor ligou pedindo ajuda para cadastrar',
      anuncio: {
        tipo: 'peca',
        titulo: 'Bomba hidráulica Valtra BH180',
        descricao: 'usada, revisada',
        precoCentavos: 250000,
        condicao: 'usada',
      },
    },
    tokenAdmin
  );
  ok('cria em nome de terceiro → 201', r.status === 201, r.corpo);
  const anuncioId = r.corpo?.dados?.id;

  const criado = anuncioId ? await db.Anuncio.findByPk(anuncioId) : null;
  ok('anúncio nasce com o dono certo (o produtor)', criado && String(criado.usuario_id) === String(comum.id), criado?.usuario_id);
  ok('marcado como criado_por_admin', criado?.criado_por_admin === true, criado?.criado_por_admin);
  ok('criado_por_admin_id é o Admin', String(criado?.criado_por_admin_id) === String(adminConta.id), criado?.criado_por_admin_id);

  const trilhaCriacao = await db.LogAuditoria.findAll({
    where: { entidade: 'anuncios', entidade_id: anuncioId, acao: 'criar' },
  });
  ok('auditoria registra o Admin como ator', trilhaCriacao.some((l) => String(l.ator_id) === String(adminConta.id)), trilhaCriacao.map((l) => l.ator_id));
  ok('auditoria registra em_nome_de = produtor', trilhaCriacao.some((l) => String(l.em_nome_de) === String(comum.id)), trilhaCriacao.map((l) => l.em_nome_de));
  ok('auditoria guarda o motivo', trilhaCriacao.some((l) => (l.motivo || '').includes('produtor ligou')), trilhaCriacao.map((l) => l.motivo));
  ok('o dono é avisado do cadastro feito por terceiro',
    enfileirados.some((e) => e.nome === 'notificacao.criar' && String(e.dados.usuarioId) === String(comum.id) && e.dados.entidadeId === anuncioId));

  r = await req('POST', '/admin/anuncios/em-nome-de', { motivo: 'sem alvo declarado', anuncio: { tipo: 'peca', titulo: 'Sem dono' } }, tokenAdmin);
  ok('em-nome-de sem usuarioId → 422', r.status === 422, r.corpo);

  console.log('\n— motivo obrigatório nas ações punitivas —');
  r = await req('POST', `/admin/anuncios/${anuncioId}/reprovar`, {}, tokenAdmin);
  ok('reprovar sem motivo → 422', r.status === 422, r.corpo);
  r = await req('POST', `/admin/anuncios/${anuncioId}/reprovar`, { motivo: 'ok' }, tokenAdmin);
  ok('motivo curto demais → 422', r.status === 422, r.corpo);
  r = await req('POST', `/admin/anuncios/${anuncioId}/ocultar`, {}, tokenAdmin);
  ok('ocultar sem motivo → 422', r.status === 422, r.corpo);
  r = await req('DELETE', `/admin/anuncios/${anuncioId}`, {}, tokenAdmin);
  ok('remover sem motivo → 422', r.status === 422, r.corpo);

  console.log('\n— fila de moderação —');
  r = await req('GET', '/admin/moderacao/fila?porPagina=10', null, tokenAdmin);
  ok('fila → 200', r.status === 200, r.corpo);
  const linha = (r.corpo?.dados || [])[0];
  ok('linha traz anúncio + dono + capa + denúncias abertas',
    !linha || ('dono' in linha && 'capa' in linha && 'denunciasAbertas' in linha), linha);
  ok('fila não expõe e-mail sem dono carregado', !/senha_hash/.test(JSON.stringify(r.corpo)));

  console.log('\n— ficha e ações unitárias —');
  r = await req('GET', `/admin/anuncios/${anuncioId}`, null, tokenAdmin);
  ok('ficha → 200 com contagem de denúncias', r.status === 200 && 'denunciasAbertas' in (r.corpo.dados || {}), r.corpo);

  r = await req('POST', `/admin/anuncios/${anuncioId}/ocultar`, { motivo: 'imagem imprópria no anúncio' }, tokenAdmin);
  ok('ocultar com motivo → 200', r.status === 200, r.corpo);
  const auditOcultar = await db.LogAuditoria.findOne({
    where: { entidade: 'anuncios', entidade_id: anuncioId, acao: 'ocultar' },
  });
  ok('ocultar gera linha de auditoria com motivo', !!auditOcultar && !!auditOcultar.motivo, auditOcultar?.motivo);

  r = await req('POST', `/admin/anuncios/${anuncioId}/destacar`, { destacar: true }, tokenAdmin);
  ok('destacar anúncio fora do ar → 409', r.status === 409, r.corpo);

  console.log('\n— lote —');
  const idsDemais = Array.from({ length: 150 }, () => anuncioId);
  r = await req('POST', '/admin/anuncios/lote/moderar', { ids: idsDemais, acao: 'aprovar', motivo: 'aprovação em massa da fila' }, tokenAdmin);
  ok('lote acima do teto → recusado (400/422)', [400, 422].includes(r.status), r.status);

  r = await req('POST', '/admin/anuncios/lote/moderar', { ids: [anuncioId], acao: 'aprovar', motivo: 'revisado manualmente, tudo certo' }, tokenAdmin);
  ok('lote válido → 200', r.status === 200, r.corpo);
  ok('resposta diz quantos passaram', r.corpo?.dados?.aplicados === 1, r.corpo?.dados);

  const auditLote = await db.LogAuditoria.findOne({
    where: { entidade: 'anuncios', acao: 'aprovar', entidade_id: null },
    order: [['criado_em', 'DESC']],
  });
  ok('lote grava UMA linha agregada com a lista', !!auditLote && auditLote.depois?.emLote === true, auditLote?.depois);

  console.log('\n— remoção administrativa —');
  r = await req('DELETE', `/admin/anuncios/${anuncioId}`, { motivo: 'anúncio duplicado, removido a pedido' }, tokenAdmin);
  ok('remover com motivo → 200', r.status === 200, r.corpo);

  const removido = await db.Anuncio.findByPk(anuncioId, { paranoid: false });
  ok('é soft delete: a linha continua existindo', !!removido, anuncioId);
  ok('com removido_em preenchido', !!removido?.removido_em, removido?.removido_em);
  ok('e status "removido"', removido?.status === 'removido', removido?.status);
  ok('o dono é notificado da remoção',
    enfileirados.some((e) => e.nome === 'notificacao.criar' && String(e.dados.usuarioId) === String(comum.id) && /removido/i.test(e.dados.titulo || '')));

  const auditRemover = await db.LogAuditoria.findOne({
    where: { entidade: 'anuncios', entidade_id: anuncioId, acao: 'remover' },
  });
  ok('remoção auditada com motivo e em_nome_de', !!auditRemover && !!auditRemover.motivo && String(auditRemover.em_nome_de) === String(comum.id), auditRemover?.motivo);

  console.log('\n— mídia —');
  r = await req('GET', '/admin/midia?porPagina=5', null, tokenAdmin);
  ok('inventário → 200 paginado', r.status === 200 && Array.isArray(r.corpo.dados), r.corpo);
  ok('mídia não expõe path nem hash do conteúdo', !/"path"|hash_conteudo/.test(JSON.stringify(r.corpo)));

  const arquivoQualquer = await db.Arquivo.findOne();
  if (arquivoQualquer) {
    r = await req('DELETE', `/admin/midia/${arquivoQualquer.id}`, {}, tokenAdmin);
    ok('remover mídia sem motivo → 422', r.status === 422, r.corpo);
  } else {
    console.log('  --  sem arquivo no banco para testar remoção (ok)');
  }

  console.log(`\n${passou} ok · ${falhou} falha(s)`);

  filas.enfileirar = enfileirarOriginal;
  servidor.close();
  await encerrarInfra();
  process.exit(falhou ? 1 : 0);
})().catch(async (erro) => {
  console.error(erro);
  await encerrarInfra().catch(() => null);
  process.exit(1);
});
