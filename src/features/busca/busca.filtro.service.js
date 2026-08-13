'use strict';

const { lerPaginacao } = require('../../utils/paginacao');
const cache = require('../../cache');
const localizacaoService = require('./busca.localizacao.service');
const { normalizarTermo } = require('./busca.comum');
const {
  ORDEM,
  ORDENS,
  POR_PAGINA_PADRAO,
  POR_PAGINA_MAXIMO,
  TERMO_MINIMO,
} = require('./busca.constants');

/**
 * Query da URL → filtros que o SQL entende.
 *
 * Existe separado porque três consultas diferentes (lista, facetas e log)
 * precisam do MESMO recorte. Se cada uma interpretasse `?min=100` por conta
 * própria, a faceta acabaria contando em reais o que a lista filtra em
 * centavos, e ninguém notaria até um usuário reclamar que "diz 12 e mostra 3".
 *
 * Também é aqui que a assinatura de cache nasce: ela é derivada dos filtros
 * JÁ normalizados, nunca da query crua — senão `?uf=mt` e `?uf=MT` gravariam
 * duas entradas para a mesma busca.
 */

/** aceita o nome curto da URL e o longo da API, nessa ordem */
const preferir = (...valores) => valores.find((valor) => valor !== undefined && valor !== '');

/** reais → centavos. `Math.round` porque o slider pode entregar 199.99 */
const paraCentavos = (reais) =>
  reais === undefined || reais === null ? null : Math.round(Number(reais) * 100);

/**
 * Monta o recorte a partir da query já validada.
 *
 * É `async` por um motivo só: resolver o ponto de origem da proximidade pode
 * exigir uma consulta ao município. Sem `lat`/`cidade`/`cep` na query, nenhuma
 * ida ao banco acontece aqui.
 */
async function montar(query = {}) {
  const termoBruto = preferir(query.q, query.termo) || '';
  const termoNormalizado = normalizarTermo(termoBruto);

  const ordemPedida = preferir(query.ord, query.ordem);

  const origemGeo = await localizacaoService.resolverOrigem({
    lat: query.lat,
    lon: query.lon,
    cep: query.cep,
    cidade: query.cidade,
    municipioId: query.municipioId,
    uf: query.uf,
    raioKm: query.raioKm,
  });

  /* pedir "mais próximo" sem informar de onde é erro do cliente, não uma lista
     em ordem aleatória: o usuário veria resultados e acharia que são os
     próximos dele */
  if (ordemPedida === ORDEM.PROXIMOS) localizacaoService.exigirOrigem(origemGeo);

  /**
   * Ordem padrão inteligente.
   *
   * Com termo, relevância; sem termo, "mais recentes". Ordenar por relevância
   * uma lista sem termo é ordenar por zero — na prática ordem do disco, que
   * muda entre duas visitas à mesma página e faz item repetir na paginação.
   */
  const ordem = ORDENS.includes(ordemPedida)
    ? ordemPedida
    : termoNormalizado.length >= TERMO_MINIMO
      ? ORDEM.RELEVANCIA
      : ORDEM.RECENTES;

  const paginacao = lerPaginacao(query, {
    porPaginaPadrao: POR_PAGINA_PADRAO,
    maximo: POR_PAGINA_MAXIMO,
  });

  const filtros = {
    termo: termoBruto.trim().slice(0, 120) || null,
    termoNormalizado: termoNormalizado.length >= TERMO_MINIMO ? termoNormalizado : null,

    categoria: preferir(query.cat, query.categoria) || null,
    marca: query.marca || null,
    maquina: query.maquina || null,

    tipo: query.tipo || null,
    condicao: preferir(query.cond, query.condicao) || null,
    negociacao: query.negociacao || null,

    precoMinCentavos: paraCentavos(query.min),
    precoMaxCentavos: paraCentavos(query.max),
    aCombinar: query.aCombinar === undefined ? null : query.aCombinar,

    dias: query.dias || null,
    aceitaEntrega: query.aceitaEntrega === undefined ? null : query.aceitaEntrega,
    aceitaTroca: query.aceitaTroca === undefined ? null : query.aceitaTroca,

    uf: query.uf ? String(query.uf).toUpperCase() : null,
    municipioId: query.municipioId || null,
    cidade: query.cidade || null,
    cidadeNormalizada: query.cidade ? normalizarTermo(query.cidade) : null,

    origemGeo,
    ordem,
    ...paginacao,
  };

  /* a assinatura NÃO inclui paginação nem ordem por engano: página 2 é outro
     resultado e precisa de outra chave. Inclui a origem geográfica arredondada
     porque duas pessoas na mesma cidade produzem coordenadas ligeiramente
     diferentes e cachear por coordenada crua daria 0% de acerto */
  filtros.assinatura = cache.assinatura({
    q: filtros.termoNormalizado,
    cat: filtros.categoria,
    marca: filtros.marca,
    maquina: filtros.maquina,
    tipo: filtros.tipo,
    cond: filtros.condicao,
    neg: filtros.negociacao,
    min: filtros.precoMinCentavos,
    max: filtros.precoMaxCentavos,
    comb: filtros.aCombinar,
    dias: filtros.dias,
    ent: filtros.aceitaEntrega,
    troca: filtros.aceitaTroca,
    uf: filtros.uf,
    mun: filtros.municipioId,
    cid: filtros.cidadeNormalizada,
    geo: origemGeo
      ? `${origemGeo.latitude.toFixed(2)},${origemGeo.longitude.toFixed(2)},${origemGeo.raioKm}`
      : null,
    ord: filtros.ordem,
    p: filtros.pagina,
    pp: filtros.porPagina,
  });

  return filtros;
}

/** assinatura do recorte sem paginação — é o que as facetas usam */
const assinaturaDeRecorte = (filtros) =>
  filtros.assinatura.replace(/(^|&)(p|pp|ord)=[^&]*/g, '');

module.exports = { montar, assinaturaDeRecorte, paraCentavos };
