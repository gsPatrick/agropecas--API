'use strict';

/**
 * Contato, de ponta a ponta, contra a API e o banco de verdade.
 *
 *   node testes/contato.test.js
 *
 * Os quatro pontos que esta suíte existe para provar:
 *   · `exibir_whatsapp = false` → o número NÃO sai, nem neste endpoint;
 *   · revelar contato é limitado POR PESSOA, atravessando anúncios (raspagem);
 *   · o contador não infla com refresh;
 *   · toda revelação de contato de terceiro vira linha em `logs_acesso_dado`.
 */

process.env.NODE_ENV = 'development';

const { RAIZ, montarApp, cliente, criarUsuario, criarAnuncio, ok } = require('./apoio.cenario');
const { limparLimites, encerrarInfra } = require('./apoio');
const db = require(RAIZ + '/src/models');
const cache = require(RAIZ + '/src/cache');
const { chaves } = require(RAIZ + '/src/features/contato/contato.cache');
const { REVELACAO } = require(RAIZ + '/src/features/contato/contato.constants');

let server;

(async () => {
  await limparLimites();
  /* as janelas deste módulo têm chave própria, fora do domínio `limite` que o
     apoio comum zera — sem isto uma segunda execução herdaria a cota gasta */
  await cache.invalidar(chaves.dominio());

  const app = montarApp('/api/v1/contatos', require(RAIZ + '/src/features/contato/contato.routes'));
  server = app.listen(0);
  const req = cliente('http://127.0.0.1:' + server.address().port + '/api/v1/contatos');

  const marca = Date.now();
  const anunciante = await criarUsuario(`ct-dono-${marca}`);
  const interessado = await criarUsuario(`ct-int-${marca}`);
  const reservado = await criarUsuario(`ct-res-${marca}`); // não quer expor o número
  const raspador = await criarUsuario(`ct-rasp-${marca}`);

  await db.Perfil.update({ exibir_whatsapp: false }, { where: { id: reservado.perfil.id } });

  const anuncio = await criarAnuncio(anunciante.usuario, anunciante.perfil, `ct-${marca}`);
  const anuncioReservado = await criarAnuncio(reservado.usuario, reservado.perfil, `ctr-${marca}`);
  const outroAnuncio = await criarAnuncio(anunciante.usuario, anunciante.perfil, `ct2-${marca}`);
  /* anúncio exclusivo do laço de raspagem: o rate-limit genérico conta por
     caminho de URL, e reaproveitar um anúncio já usado no teste faria ELE
     disparar antes da cota por pessoa — que é justamente o que se quer medir */
  const anuncioRaspagem = await criarAnuncio(anunciante.usuario, anunciante.perfil, `ct3-${marca}`);

  console.log('\n— registrar intenção de contato —');
  let r = await req('POST', '/anuncios/' + anuncio.id, { canal: 'whatsapp', origem: 'detalhe' });
  ok('visitante sem login registra contato → 201', r.status === 201 && r.corpo.dados.registrado === true, r.corpo);

  let contato = await db.AnuncioContato.findOne({ where: { anuncio_id: anuncio.id }, order: [['criado_em', 'DESC']] });
  ok('interessado nulo quando é visitante', contato && contato.interessado_id === null, contato?.interessado_id);
  ok('IP gravado só em hash', contato.ip_hash && contato.ip_hash.length === 64, contato.ip_hash);

  await anuncio.reload();
  ok('contador do anúncio subiu', anuncio.total_contatos_whatsapp === 1, anuncio.total_contatos_whatsapp);

  console.log('\n— o contador não infla com refresh —');
  for (let i = 0; i < 5; i++) {
    r = await req('POST', '/anuncios/' + anuncio.id, { canal: 'whatsapp', origem: 'detalhe' });
  }
  ok('repetição na janela → registrado=false, motivo duplicado', r.status === 201 && r.corpo.dados.registrado === false && r.corpo.dados.motivo === 'duplicado', r.corpo);

  const linhas = await db.AnuncioContato.count({ where: { anuncio_id: anuncio.id } });
  ok('seis cliques viraram UMA linha', linhas === 1, linhas);
  await anuncio.reload();
  ok('contador continua em 1 depois de seis cliques', anuncio.total_contatos_whatsapp === 1, anuncio.total_contatos_whatsapp);

  r = await req('POST', '/anuncios/' + anuncio.id, { canal: 'chat', origem: 'detalhe' });
  ok('canal diferente é contato diferente → registrado', r.corpo.dados.registrado === true, r.corpo);
  await anuncio.reload();
  ok('chat conta em coluna própria', anuncio.total_contatos_chat === 1, anuncio.total_contatos_chat);

  r = await req('POST', '/anuncios/' + outroAnuncio.id, { canal: 'whatsapp' }, anunciante.token);
  ok('o anunciante não gera contato no próprio anúncio', r.corpo.dados.registrado === false && r.corpo.dados.motivo === 'proprio_anuncio', r.corpo);

  r = await req('POST', '/anuncios/' + anuncio.id, { canal: 'pombo-correio' });
  ok('canal fora do vocabulário → 422', r.status === 422, r.corpo);

  console.log('\n— revelar contato exige conta —');
  r = await req('POST', '/anuncios/' + anuncio.id + '/revelar', {});
  ok('visitante pedindo o WhatsApp → 401', r.status === 401, r.corpo);

  r = await req('POST', '/anuncios/' + anuncio.id + '/revelar', { origem: 'detalhe' }, interessado.token);
  ok('logado recebe o número → 200', r.status === 200 && r.corpo.dados.whatsapp === '+5565999991234', r.corpo);
  ok('informa a cota restante', typeof r.corpo.dados.revelacoesRestantes === 'number', r.corpo.dados);

  const acessos = await db.LogAcessoDado.count({
    where: { ator_id: interessado.usuario.id, titular_id: anunciante.usuario.id, recurso: 'telefone' },
  });
  ok('revelação gravou logs_acesso_dado (LGPD)', acessos >= 1, acessos);

  console.log('\n— exibir_whatsapp = false: o número NÃO sai —');
  r = await req('POST', '/anuncios/' + anuncioReservado.id + '/revelar', { origem: 'detalhe' }, interessado.token);
  ok('resposta 200 mas sem número', r.status === 200 && r.corpo.dados.whatsapp === null, r.corpo);
  ok('diz por quê, para o front oferecer o chat', r.corpo.dados.exibirWhatsapp === false && r.corpo.dados.aceitaChat === true, r.corpo.dados);
  ok('o número não aparece em nenhum canto da resposta', !JSON.stringify(r.corpo).includes('5565999991234'), r.corpo);

  const negado = await db.LogAcessoDado.findOne({
    where: { ator_id: interessado.usuario.id, titular_id: reservado.usuario.id },
    order: [['criado_em', 'DESC']],
  });
  ok('a tentativa negada também vira log', negado && /negado_por_consentimento/.test(negado.motivo), negado?.motivo);

  const contatoIndevido = await db.AnuncioContato.count({ where: { anuncio_id: anuncioReservado.id } });
  ok('sem número revelado, não há contato a contar', contatoIndevido === 0, contatoIndevido);

  console.log('\n— rate limit da revelação (o vetor do módulo) —');
  let ultimo;
  for (let i = 0; i < REVELACAO.MAXIMO; i++) {
    ultimo = await req('POST', '/anuncios/' + anuncioRaspagem.id + '/revelar', {}, raspador.token);
  }
  ok(`${REVELACAO.MAXIMO} revelações passam`, ultimo.status === 200, ultimo.corpo);

  // o teste que separa a cota real do rate-limit genérico: OUTRO anúncio, ou
  // seja, outro caminho de URL. Se a proteção fosse por rota, este passaria.
  r = await req('POST', '/anuncios/' + outroAnuncio.id + '/revelar', {}, raspador.token);
  ok('a 31ª em OUTRO anúncio → 429 (a cota é por pessoa, não por anúncio)', r.status === 429, r.corpo);
  ok('o 429 vem da cota por pessoa, não do limitador de rota', /muitos contatos/i.test(r.corpo?.erro?.mensagem || ''), r.corpo?.erro);
  ok('devolve quanto falta esperar', r.corpo?.erro?.detalhe?.segundosRestantes > 0, r.corpo?.erro);

  r = await req('POST', '/anuncios/' + outroAnuncio.id + '/revelar', {}, interessado.token);
  ok('outra pessoa não é afetada pela cota do raspador', r.status === 200, r.corpo);

  console.log('\n— contatos recebidos —');
  r = await req('GET', '/anuncios/' + anuncio.id + '/recebidos', null, anunciante.token);
  ok('o dono vê quem o procurou', r.status === 200 && r.corpo.dados.length >= 2, r.corpo?.meta);
  ok('contato de visitante aparece como anônimo', r.corpo.dados.some((c) => c.anonimo === true), r.corpo.dados);
  ok('não vaza ip_hash nem user agent', !/ip_hash|userAgent|user_agent/.test(JSON.stringify(r.corpo)), r.corpo.dados[0]);
  ok('não devolve telefone de quem clicou', !/whatsapp"\s*:\s*"/.test(JSON.stringify(r.corpo)), r.corpo.dados[0]);

  r = await req('GET', '/anuncios/' + anuncio.id + '/recebidos', null, interessado.token);
  ok('contatos de anúncio alheio → 403', r.status === 403, r.corpo);

  r = await req('GET', '/recebidos', null, anunciante.token);
  ok('lista consolidada dos meus anúncios → 200', r.status === 200 && r.corpo.dados.length >= 2, r.corpo?.meta);

  console.log('\n— métricas (agregação por job) —');
  const metricaService = require(RAIZ + '/src/features/contato/contato.metrica.service');
  const agregado = await metricaService.agregarDia({ anuncioId: anuncio.id });
  ok('job agrega o dia', agregado.anuncios === 1, agregado);

  const diaria = await db.AnuncioMetricaDiaria.findOne({ where: { anuncio_id: anuncio.id } });
  ok('gravou cliques_whatsapp e conversas_iniciadas', diaria && diaria.cliques_whatsapp >= 1 && diaria.conversas_iniciadas === 1, diaria?.toJSON());

  const antes = diaria.cliques_whatsapp;
  await metricaService.agregarDia({ anuncioId: anuncio.id });
  await diaria.reload();
  ok('rodar o job duas vezes não duplica (idempotente)', diaria.cliques_whatsapp === antes, [antes, diaria.cliques_whatsapp]);

  await metricaService.recalcularTotaisDePerfil();
  await anunciante.perfil.reload();
  ok('perfis.total_contatos recalculado pelo job', anunciante.perfil.total_contatos >= 2, anunciante.perfil.total_contatos);

  r = await req('GET', '/anuncios/' + anuncio.id + '/metricas', null, anunciante.token);
  ok('o dono lê a série → 200', r.status === 200 && r.corpo.dados.totais.contatos >= 2, r.corpo?.dados?.totais);
  r = await req('GET', '/anuncios/' + anuncio.id + '/metricas', null, interessado.token);
  ok('métrica de anúncio alheio → 403', r.status === 403, r.corpo);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
