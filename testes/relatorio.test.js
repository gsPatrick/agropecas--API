'use strict';

/**
 * Módulo de relatórios, pela rede e contra o banco de verdade.
 *
 *   node testes/relatorio.test.js
 *
 * Relatório é onde vazamento agregado acontece: os números certos com o filtro
 * de dono errado entregam o movimento do concorrente sem que ninguém abra um
 * anúncio alheio. Por isso a suíte insiste em escopo, teto de período e
 * permissão — mais do que na aritmética.
 *
 * As rotas ainda não estão em `src/routes/index.js` (arquivo compartilhado,
 * montado pelo orquestrador), então a suíte sobe um segundo servidor com o
 * router do módulo — o mesmo que a API vai usar.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const { limparLimites, encerrarInfra } = require('./apoio');
const app = require(RAIZ + '/app');
const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');
const registroFilas = require(RAIZ + '/src/filas/registro');
require(RAIZ + '/src/filas');
const { MINIMO_AGREGACAO, PERIODO_MAX_DIAS } = require(RAIZ + '/src/features/relatorio/relatorio.constants');
const cacheRelatorio = require(RAIZ + '/src/features/relatorio/relatorio.cache');

const MARCA = String(Date.now()).slice(-8);

let servidorAuth;
let servidorRel;

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

const dia = (deslocamento) => {
  const data = new Date();
  data.setUTCDate(data.getUTCDate() + deslocamento);
  return data.toISOString().slice(0, 10);
};

const criados = { anuncios: [], buscas: [], contatos: [], conversas: [], metricas: [], termos: [], arquivos: [] };

(async () => {
  await limparLimites();

  servidorAuth = app.listen(0);
  const auth = chamar('http://127.0.0.1:' + servidorAuth.address().port + '/api/v1/auth');

  const apiRel = express();
  apiRel.use(express.json());
  apiRel.use(middlewares.contexto);
  apiRel.use('/relatorios', require(RAIZ + '/src/features/relatorio/relatorio.routes'));
  apiRel.use(middlewares.erro);
  servidorRel = apiRel.listen(0);
  const req = chamar('http://127.0.0.1:' + servidorRel.address().port);

  const cadastrar = async (sufixo) => {
    const email = `rel-${sufixo}-${MARCA}@agropecas.dev`;
    const r = await auth('POST', '/registrar', {
      nome: 'Anunciante ' + sufixo,
      email,
      senha: 'SenhaForte123',
      tipoPerfil: 'loja',
      nomeExibicao: `Loja ${sufixo} ${MARCA}`,
      aceiteTermos: true,
      aceitePrivacidade: true,
    });
    if (!r.corpo?.dados) throw new Error('cadastro falhou: ' + JSON.stringify(r.corpo));
    return { email, ...r.corpo.dados };
  };

  const anaRet = await cadastrar('ana');
  const beto = await cadastrar('beto');

  const ana = await db.Usuario.findOne({ where: { email_normalizado: anaRet.email.toLowerCase() } });
  const bet = await db.Usuario.findOne({ where: { email_normalizado: beto.email.toLowerCase() } });
  const perfilAna = await db.Perfil.findOne({ where: { usuario_id: ana.id } });
  const perfilBeto = await db.Perfil.findOne({ where: { usuario_id: bet.id } });

  // ── dados de apoio (identificados pela marca do teste) ────────
  const criarAnuncio = async (usuario, perfil, sufixo) => {
    const anuncio = await db.Anuncio.create({
      codigo: `T${MARCA}${sufixo}`.slice(0, 12),
      usuario_id: usuario.id,
      perfil_id: perfil.id,
      titulo: `Bomba injetora teste ${MARCA}${sufixo}`,
      titulo_normalizado: `bomba injetora teste ${MARCA}${sufixo}`,
      slug: `bomba-injetora-teste-${MARCA}${sufixo}`,
      descricao: 'Anúncio criado por teste automatizado.',
      /* o schema tem `ck_anuncios_preco_ou_combinar`: ou há preço, ou é a
         combinar. Anúncio sem os dois não existe no banco */
      preco_a_combinar: true,
      status: 'publicado',
      publicado_em: new Date(),
    });
    criados.anuncios.push(anuncio.id);
    return anuncio;
  };

  const anuncioAna = await criarAnuncio(ana, perfilAna, 'a');
  const anuncioBeto = await criarAnuncio(bet, perfilBeto, 'b');

  /* métricas em dois períodos: o de hoje e o imediatamente anterior de mesmo
     tamanho — é o que permite verificar a comparação */
  const metricas = [
    { anuncio_id: anuncioAna.id, data: dia(-1), visualizacoes: 100, cliques_whatsapp: 10, favoritos: 4, conversas_iniciadas: 3 },
    { anuncio_id: anuncioAna.id, data: dia(0), visualizacoes: 50, cliques_whatsapp: 5, favoritos: 1, conversas_iniciadas: 1 },
    { anuncio_id: anuncioAna.id, data: dia(-3), visualizacoes: 30, cliques_whatsapp: 2, favoritos: 0, conversas_iniciadas: 0 },
    { anuncio_id: anuncioBeto.id, data: dia(0), visualizacoes: 999, cliques_whatsapp: 99, favoritos: 9, conversas_iniciadas: 9 },
  ];
  for (const metrica of metricas) {
    const linha = await db.AnuncioMetricaDiaria.create(metrica);
    criados.metricas.push(linha.id);
  }

  const conversa = await db.Conversa.create({
    anuncio_id: anuncioAna.id,
    anunciante_id: ana.id,
    interessado_id: bet.id,
  });
  criados.conversas.push(conversa.id);

  for (const canal of ['whatsapp', 'whatsapp', 'chat']) {
    const contato = await db.AnuncioContato.create({
      anuncio_id: anuncioAna.id,
      anunciante_id: ana.id,
      canal,
      origem: 'detalhe',
    });
    criados.contatos.push(contato.id);
  }

  /* dois termos de propósito: um com 6 ocorrências (acima do piso de
     agregação) e um com 1 (abaixo — precisa ser suprimido) */
  const termoComum = `filtro oleo ${MARCA}`;
  const termoRaro = `peca rarissima ${MARCA}`;
  for (let i = 0; i < 6; i += 1) {
    const log = await db.BuscaLog.create({
      termo: termoComum,
      termo_normalizado: termoComum,
      sem_resultado: true,
      total_resultados: 0,
      uf: 'MT',
      categoria_id: null,
      sessao_hash: `s${i}`,
    });
    criados.buscas.push(log.id);
  }
  const raro = await db.BuscaLog.create({
    termo: termoRaro,
    termo_normalizado: termoRaro,
    sem_resultado: true,
    total_resultados: 0,
    uf: 'MT',
    sessao_hash: 'unico',
  });
  criados.buscas.push(raro.id);

  await cacheRelatorio.invalidarTudo();

  const periodo = `de=${dia(-6)}&ate=${dia(0)}`;

  // ── permissão ────────────────────────────────────────────────
  console.log('\n— sem permissão não há relatório —');
  let r = await req('GET', `/relatorios/painel?${periodo}`, null, anaRet.tokens.acesso);
  ok('anunciante comum no painel geral → 403', r.status === 403, r.corpo);

  r = await req('GET', `/relatorios/busca?${periodo}`, null, anaRet.tokens.acesso);
  ok('anunciante comum no relatório de busca → 403', r.status === 403, r.corpo);

  r = await req('POST', '/relatorios/exportar', { relatorio: 'painel', de: dia(-6), ate: dia(0) }, anaRet.tokens.acesso);
  ok('anunciante comum exportando → 403', r.status === 403, r.corpo);

  r = await req('GET', `/relatorios/painel?${periodo}`);
  ok('sem token → 401', r.status === 401, r.corpo);

  // ── período obrigatório e com teto ───────────────────────────
  console.log('\n— período obrigatório, com teto rígido —');
  const papelAdmin = await db.Papel.findOne({ where: { chave: 'admin' } });
  await db.UsuarioPapel.create({ usuario_id: ana.id, papel_id: papelAdmin.id });
  const tokenAdmin = (await auth('POST', '/entrar', { email: anaRet.email, senha: 'SenhaForte123' })).corpo.dados
    .tokens.acesso;

  r = await req('GET', '/relatorios/painel', null, tokenAdmin);
  ok('painel sem período → 422 (campos obrigatórios)', r.status === 422, r.corpo);

  r = await req('GET', `/relatorios/painel?de=2015-01-01&ate=${dia(0)}`, null, tokenAdmin);
  ok('período acima do teto → 400', r.status === 400, r.corpo);
  ok(`e a mensagem informa o teto de ${PERIODO_MAX_DIAS} dias`, r.corpo?.erro?.detalhe?.maximo === PERIODO_MAX_DIAS, r.corpo?.erro);

  r = await req('GET', `/relatorios/painel?de=${dia(0)}&ate=${dia(-6)}`, null, tokenAdmin);
  ok('data final antes da inicial → 400', r.status === 400, r.corpo);

  r = await req('GET', `/relatorios/desempenho?de=2015-01-01&ate=${dia(0)}`, null, beto.tokens.acesso);
  ok('o teto vale para o desempenho também → 400', r.status === 400, r.corpo);

  // ── painel geral ─────────────────────────────────────────────
  console.log('\n— painel geral (Admin) —');
  r = await req('GET', `/relatorios/painel?${periodo}`, null, tokenAdmin);
  ok('admin lê o painel → 200', r.status === 200, r.corpo);
  const painel = r.corpo?.dados;
  ok('conta usuários novos por papel', Array.isArray(painel?.usuarios?.porPapel) && painel.usuarios.porPapel.length > 0, painel?.usuarios);
  ok('conta anúncios por status', painel?.anuncios?.porStatus?.some((item) => item.status === 'publicado'), painel?.anuncios);
  ok('conta conversas iniciadas', painel?.conversas?.iniciadas >= 1, painel?.conversas);
  ok('conta contatos por canal', painel?.contatos?.porCanal?.find((item) => item.canal === 'whatsapp')?.total >= 2, painel?.contatos);
  ok('mostra buscas sem resultado', painel?.buscas?.semResultado?.some((item) => item.termo === termoComum), painel?.buscas?.semResultado);

  console.log('\n— agregação mínima protege quem buscou —');
  ok(
    `termo com 1 ocorrência não aparece (piso ${MINIMO_AGREGACAO})`,
    !painel?.buscas?.semResultado?.some((item) => item.termo === termoRaro),
    painel?.buscas?.semResultado
  );
  ok('mas o total suprimido é informado', typeof painel?.buscas?.semResultadoOcultados === 'number' && painel.buscas.semResultadoOcultados >= 1, painel?.buscas);
  ok('e o piso usado é declarado na resposta', painel?.buscas?.minimoAgregacao === MINIMO_AGREGACAO, painel?.buscas);

  // ── escopo do desempenho ─────────────────────────────────────
  console.log('\n— cada anunciante vê só os próprios números —');
  r = await req('GET', `/relatorios/desempenho?${periodo}`, null, beto.tokens.acesso);
  ok('anunciante lê o próprio desempenho → 200', r.status === 200, r.corpo);
  ok('e o número é o dele (999 visualizações)', r.corpo?.dados?.totais?.visualizacoes === 999, r.corpo?.dados?.totais);

  r = await req('GET', `/relatorios/desempenho?${periodo}&usuarioId=${ana.id}`, null, beto.tokens.acesso);
  ok('anunciante pedindo o número de TERCEIRO → 403', r.status === 403, r.corpo);

  r = await req('GET', `/relatorios/desempenho?${periodo}&usuarioId=${bet.id}`, null, tokenAdmin);
  ok('admin vê o desempenho de terceiro → 200', r.status === 200, r.corpo);
  ok('e a resposta marca que não é o próprio', r.corpo?.dados?.proprio === false, r.corpo?.dados);

  console.log('\n— comparação com o período anterior —');
  r = await req('GET', `/relatorios/desempenho?de=${dia(-1)}&ate=${dia(0)}`, null, tokenAdmin);
  const comparacao = r.corpo?.dados?.comparacao?.visualizacoes;
  ok('soma o período atual (100 + 50)', comparacao?.atual === 150, r.corpo?.dados?.totais);
  ok('soma o período anterior de mesmo tamanho (30)', comparacao?.anterior === 30, comparacao);
  ok('e calcula a variação', comparacao?.variacaoPercentual === 400, comparacao);
  ok('a série diária vem agrupada do banco', (r.corpo?.dados?.serie || []).length === 2, r.corpo?.dados?.serie);

  // ── relatório de busca ───────────────────────────────────────
  console.log('\n— relatório de busca —');
  const executarJob = (nome, dados) => registroFilas.obter(nome).executor(dados);
  await executarJob('relatorio.agregarTermos', { dias: 2 });

  r = await req('GET', `/relatorios/busca?${periodo}`, null, tokenAdmin);
  ok('admin lê o relatório de busca → 200', r.status === 200, r.corpo);
  const busca = r.corpo?.dados;
  ok('termo popular consolidado aparece', busca?.termosMaisBuscados?.some((item) => item.termoNormalizado === termoComum), busca?.termosMaisBuscados);
  ok('termo raro continua suprimido', !busca?.termosMaisBuscados?.some((item) => item.termoNormalizado === termoRaro), busca?.termosMaisBuscados);
  ok('mostra taxa de busca sem resultado', typeof busca?.filtros?.taxaSemResultado === 'number', busca?.filtros);
  ok('mostra os filtros mais usados', Array.isArray(busca?.filtros?.porFiltro) && busca.filtros.porFiltro.length > 0, busca?.filtros);

  // ── exportação pela fila ─────────────────────────────────────
  console.log('\n— exportação passa pela fila, nunca pela resposta —');
  r = await req('POST', '/relatorios/exportar', { relatorio: 'painel', de: dia(-6), ate: dia(0) }, tokenAdmin);
  ok('exportar responde 202 (aceito), não 200', r.status === 202, r.corpo);
  ok('devolve protocolo e status na_fila', !!r.corpo?.dados?.protocolo && r.corpo.dados.status === 'na_fila', r.corpo?.dados);

  r = await req('POST', '/relatorios/exportar', { relatorio: 'painel', de: '2015-01-01', ate: dia(0) }, tokenAdmin);
  ok('exportação também tem teto de período → 400', r.status === 400, r.corpo);

  const resultadoJob = await executarJob('relatorio.exportar', {
    protocolo: 'teste',
    relatorio: 'painel',
    formato: 'csv',
    de: dia(-6),
    ate: dia(0),
    filtros: {},
    solicitanteId: ana.id,
  });
  criados.arquivos.push(resultadoJob.arquivoId);
  ok('o job gera o CSV e registra o arquivo', !!resultadoJob.arquivoId && resultadoJob.linhas > 0, resultadoJob);

  r = await req('GET', '/relatorios/exportacoes', null, tokenAdmin);
  const exportado = (r.corpo?.dados || []).find((item) => item.id === resultadoJob.arquivoId);
  ok('a exportação aparece na lista do solicitante', !!exportado, r.corpo?.dados);
  ok('com link assinado e prazo de validade', !!exportado?.download?.token && !!exportado?.download?.expiraEm, exportado?.download);

  r = await req('GET', `/relatorios/exportacoes/${resultadoJob.arquivoId}/baixar?t=token-falso`, null, tokenAdmin);
  ok('link com assinatura errada → 404', r.status === 404, r.corpo);

  r = await req('GET', `/relatorios/exportacoes/${resultadoJob.arquivoId}/baixar?t=${encodeURIComponent(exportado.download.token)}`, null, beto.tokens.acesso);
  ok('exportação de terceiro → 403 (nem chega a existir para ele)', r.status === 403 || r.status === 404, r.corpo);

  console.log('\n— rastro —');
  const log = await db.LogAuditoria.findOne({
    where: { acao: 'exportar_dados', entidade: 'relatorio', ator_id: ana.id },
    order: [['criado_em', 'DESC']],
  });
  ok('pedido de exportação ficou em logs_auditoria', !!log, log?.acao);

  // ── faxina ───────────────────────────────────────────────────
  await db.Arquivo.destroy({ where: { id: criados.arquivos }, force: true });
  await db.AnuncioMetricaDiaria.destroy({ where: { id: criados.metricas } });
  await db.AnuncioContato.destroy({ where: { id: criados.contatos } });
  await db.Conversa.destroy({ where: { id: criados.conversas }, force: true });
  await db.BuscaLog.destroy({ where: { id: criados.buscas } });
  await db.TermoPopular.destroy({ where: { termo_normalizado: [termoComum, termoRaro] } });
  await db.Anuncio.destroy({ where: { id: criados.anuncios }, force: true });
  await cacheRelatorio.invalidarTudo();

  console.log(falhas === 0 ? '\n✅ relatorio: todas as verificações passaram' : `\n❌ relatorio: ${falhas} falha(s)`);

  servidorAuth.close();
  servidorRel.close();
  await db.sequelize.close();
  await encerrarInfra();
  process.exit(falhas === 0 ? 0 : 1);
})().catch((erro) => {
  console.error('ERRO:', erro);
  servidorAuth?.close();
  servidorRel?.close();
  process.exit(1);
});
