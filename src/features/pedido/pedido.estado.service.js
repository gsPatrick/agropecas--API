'use strict';

const db = require('../../models');
const { AppError } = require('../../utils/erros');
const { TRANSICOES } = require('./pedido.constants');

/**
 * Única porta de mudança de status do pedido.
 *
 * Toda transição passa por aqui para que três coisas nunca se separem: a
 * regra (pode ir de A para B?), a escrita e a linha de histórico. Um
 * `pedido.update({ status })` solto em outro service é exatamente o que
 * deixaria um pedido "entregue" sem ninguém saber quem confirmou.
 *
 * Sempre dentro da transação de quem chama, com o pedido já travado
 * (`lock: UPDATE`) — webhook e clique do comprador chegam ao mesmo tempo
 * com frequência maior do que parece.
 */

const podeIr = (de, para) => (TRANSICOES[de] || []).includes(para);

function exigirTransicao(pedido, para) {
  if (podeIr(pedido.status, para)) return;
  throw new AppError(
    `Este pedido está "${pedido.status}" e não pode passar para "${para}".`,
    409,
    'TRANSICAO_INVALIDA',
    { de: pedido.status, para }
  );
}

/**
 * @param ator.contexto  contexto da requisição (null = sistema/webhook)
 * @param campos         colunas a gravar junto com o status
 */
async function transicionar(pedido, para, { contexto = null, motivo, campos = {}, dados, transacao, origem }) {
  exigirTransicao(pedido, para);
  const de = pedido.status;

  await pedido.update({ ...campos, status: para }, { transaction: transacao });

  await db.PedidoHistorico.create(
    {
      pedido_id: pedido.id,
      status_anterior: de,
      status_novo: para,
      ator_id: contexto?.usuarioId || null,
      ator_papel: contexto ? (contexto.papeis || [])[0] || null : origem || 'sistema',
      motivo: motivo || null,
      dados: dados || null,
    },
    { transaction: transacao }
  );

  return pedido;
}

/** trava a linha para o resto da transação — leitura e escrita serializadas */
async function travar(pedidoId, transacao) {
  return db.Pedido.findByPk(pedidoId, { transaction: transacao, lock: transacao.LOCK.UPDATE });
}

module.exports = { podeIr, exigirTransicao, transicionar, travar };
