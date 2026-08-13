'use strict';

const { lerPaginacao } = require('../../../utils/paginacao');

/**
 * Leitura de filtros das telas do painel.
 *
 * As listagens administrativas têm o mesmo formato em toda tela: período,
 * busca textual, status e paginação. Repetir isso em quinze services seria
 * garantir que os tetos divergissem — e teto é o que impede `porPagina=99999`
 * de derrubar o banco.
 */

/** teto mais generoso que o público: o painel exporta e compara listas */
const PAGINACAO = { porPaginaPadrao: 25, maximo: 200 };

/** período máximo por consulta — sem isto, "desde sempre" varre a tabela toda */
const DIAS_MAXIMO = 366;

function lerFiltros(query = {}, { camposOrdenacao = [], ordemPadrao = 'criado_em' } = {}) {
  const paginacao = lerPaginacao(query, PAGINACAO);

  const ordenarPor = camposOrdenacao.includes(query.ordenarPor) ? query.ordenarPor : ordemPadrao;
  const direcao = String(query.direcao).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  return {
    ...paginacao,
    busca: (query.busca || query.q || '').trim() || null,
    ordem: [[ordenarPor, direcao]],
    periodo: lerPeriodo(query),
  };
}

/**
 * Período com teto. Devolve `null` quando nada foi informado — a consulta
 * decide se período é obrigatório, porque para uma fila de moderação não é, e
 * para um relatório é.
 */
function lerPeriodo({ de, ate } = {}) {
  if (!de && !ate) return null;

  const inicio = de ? new Date(de) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const fim = ate ? new Date(ate) : new Date();

  const dias = (fim - inicio) / (24 * 60 * 60 * 1000);
  if (dias > DIAS_MAXIMO) {
    const { erros } = require('../../../utils/erros');
    throw erros.invalido(`Período máximo de ${DIAS_MAXIMO} dias por consulta.`, { dias: Math.round(dias) });
  }

  return { inicio, fim };
}

module.exports = { lerFiltros, lerPeriodo, PAGINACAO, DIAS_MAXIMO };
