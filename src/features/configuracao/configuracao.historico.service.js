'use strict';

const db = require('../../models');
const { lerPaginacao } = require('../../utils/paginacao');
const { ACAO_AUDITORIA, ENTIDADE } = require('./configuracao.constants');

/**
 * Histórico de alterações de uma configuração.
 *
 * Não existe tabela própria: a trilha já é gravada em `logs_auditoria` pela
 * escrita, e duplicar isso numa `configuracoes_historico` criaria duas fontes
 * da verdade que um dia divergem. Aqui é só a consulta filtrada.
 */
async function listar(configuracaoId, query = {}) {
  const { pagina, porPagina, offset, limit } = lerPaginacao(query, { porPaginaPadrao: 20, maximo: 100 });

  const { rows, count } = await db.LogAuditoria.findAndCountAll({
    where: { entidade: ENTIDADE, entidade_id: configuracaoId, acao: ACAO_AUDITORIA },
    attributes: ['id', 'ator_id', 'ator_papel', 'antes', 'depois', 'motivo', 'criado_em'],
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

module.exports = { listar };
