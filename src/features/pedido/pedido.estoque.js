'use strict';

const db = require('../../models');
const cache = require('../../cache');
const { chaves } = require('../anuncio/anuncio.cache');

/**
 * Reserva e devolução de estoque (`anuncios.quantidade`).
 *
 * A peça sai do estoque no CHECKOUT, não na aprovação do pagamento: com
 * quantidade 1, baixar só no `approved` deixa dois compradores pagarem pela
 * mesma peça. A reserva vale `pagamento.reservaMinutos`; se o pagamento não
 * vier, o job `pedido.expirarReservas` devolve.
 *
 * `quantidade` nula = o anunciante não controla estoque, e nada é reservado
 * (`estoque_reservado` fica false e a devolução vira no-op).
 *
 * `UPDATE ... WHERE quantidade >= :q` e não ler-subtrair-gravar: duas compras
 * simultâneas da última unidade não podem ambas passar.
 */

async function invalidarAnuncio(anuncioId) {
  await cache.remover(chaves.detalhe(anuncioId));
  await cache.invalidar(chaves.dominioListas());
}

/**
 * @returns {Promise<'reservado'|'sem_controle'|'esgotado'>}
 */
async function reservar(anuncioId, quantidade, transacao) {
  const [linhas] = await db.sequelize.query(
    `UPDATE anuncios SET quantidade = quantidade - :quantidade, atualizado_em = NOW()
      WHERE id = :anuncioId AND quantidade IS NOT NULL AND quantidade >= :quantidade
      RETURNING id`,
    { replacements: { anuncioId, quantidade }, transaction: transacao }
  );
  if (linhas.length) return 'reservado';

  const anuncio = await db.Anuncio.findByPk(anuncioId, {
    attributes: ['id', 'quantidade'],
    transaction: transacao,
  });
  return anuncio && anuncio.quantidade === null ? 'sem_controle' : 'esgotado';
}

/** devolve o que o pedido reservou — só se reservou */
async function devolver(pedido, transacao) {
  if (!pedido.estoque_reservado) return false;

  await db.sequelize.query(
    `UPDATE anuncios SET quantidade = quantidade + :quantidade, atualizado_em = NOW()
      WHERE id = :anuncioId AND quantidade IS NOT NULL`,
    { replacements: { anuncioId: pedido.anuncio_id, quantidade: pedido.quantidade }, transaction: transacao }
  );
  await pedido.update({ estoque_reservado: false }, { transaction: transacao });
  return true;
}

module.exports = { reservar, devolver, invalidarAnuncio };
