'use strict';

const { registrar } = require('../registro');
const { FILAS } = require('../definicoes');

/**
 * Agregação de métricas de contato.
 *
 * Existe para tirar dois UPDATE do caminho da resposta. O registro de contato
 * é chamado em toda listagem e em todo clique de WhatsApp — é uma das rotas
 * mais quentes do sistema, e recalcular métrica diária ali dentro faria o
 * usuário esperar por um número que ninguém está olhando naquele instante.
 *
 * Os services são carregados dentro do executor, não no topo: o registro de
 * trabalho é importado no boot, e puxar os models junto atrasaria a subida da
 * API sem necessidade. Mesmo padrão de `manutencao.trabalho.js`.
 */

/**
 * Recalcula o dia de um anúncio (ou o dia inteiro, sem `anuncioId`).
 *
 * Recontar em vez de somar delta é o que torna o job seguro para retentativa:
 * o BullMQ reexecuta sozinho depois de uma falha, e um job que somasse
 * duplicaria a métrica sem deixar rastro.
 */
const AGREGAR_METRICAS = registrar(
  'contato.agregarMetricas',
  async ({ anuncioId, data } = {}) => {
    const metrica = require('../../features/contato/contato.metrica.service');
    return metrica.agregarDia({ anuncioId, data });
  },
  { fila: FILAS.INDEXACAO.nome }
);

/**
 * Fecha o dia: agrega a plataforma inteira e recalcula `perfis.total_contatos`.
 *
 * Feito uma vez por dia, e não a cada contato, porque `total_contatos` é
 * vitrine — o perfil público mostrando 339 em vez de 340 por algumas horas não
 * causa dano nenhum, e recalcular a cada clique causaria contenção na linha do
 * perfil de uma loja movimentada.
 */
const FECHAR_DIA = registrar(
  'contato.fecharDia',
  async ({ data } = {}) => {
    const metrica = require('../../features/contato/contato.metrica.service');

    const agregado = await metrica.agregarDia({ data });
    const perfis = await metrica.recalcularTotaisDePerfil();

    return { ...agregado, ...perfis };
  },
  { fila: FILAS.INDEXACAO.nome }
);

module.exports = { AGREGAR_METRICAS, FECHAR_DIA };
