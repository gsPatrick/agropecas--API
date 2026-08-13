'use strict';

const PADRAO = { pagina: 1, porPagina: 20, maximo: 100 };

/**
 * Lê paginação da query com teto.
 *
 * O teto não é capricho: sem ele, `?porPagina=100000` vira um jeito trivial de
 * derrubar o banco, e não precisa de má-fé — basta um script de terceiro.
 */
function lerPaginacao(query = {}, { porPaginaPadrao = PADRAO.porPagina, maximo = PADRAO.maximo } = {}) {
  const pagina = Math.max(1, Number(query.pagina || query.p || PADRAO.pagina) || 1);
  const solicitado = Number(query.porPagina || query.pp || porPaginaPadrao) || porPaginaPadrao;
  const porPagina = Math.min(Math.max(1, solicitado), maximo);

  return { pagina, porPagina, offset: (pagina - 1) * porPagina, limit: porPagina };
}

const montarMeta = ({ pagina, porPagina, total }) => ({
  pagina,
  porPagina,
  total,
  totalPaginas: Math.max(1, Math.ceil(total / porPagina)),
});

module.exports = { lerPaginacao, montarMeta, PADRAO };
