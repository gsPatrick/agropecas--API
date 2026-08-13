'use strict';

const db = require('../../models');
const acesso = require('./anuncio.acesso.service');
const { STATUS_ATIVOS } = require('./anuncio.constants');

/**
 * Trilha de estado do anúncio.
 *
 * Toda mudança de status grava uma linha — é o que responde "quem ocultou este
 * anúncio e por quê", exigência direta do poder de intervenção total do Admin
 * (Maturacao/05, §2.4). A tabela é append-only: nada aqui atualiza linha
 * existente, porque histórico que pode ser reescrito não é histórico.
 *
 * O ajuste do contador do perfil mora junto de propósito: ele muda exatamente
 * nos mesmos momentos, e separá-lo criaria a chance de gravar um sem o outro.
 */

/** roda dentro da transação de quem mudou o status */
const registrar = (anuncio, { de, para, contexto, motivo, alteracoes, transacao }) =>
  db.AnuncioHistorico.create(
    {
      anuncio_id: anuncio.id,
      status_anterior: de,
      status_novo: para,
      ator_id: contexto?.usuarioId || null,
      ator_papel: (contexto?.papeis || [])[0] || null,
      motivo: motivo || null,
      alteracoes: alteracoes || null,
      ip_hash: contexto?.ipHash || null,
    },
    { transaction: transacao }
  );

/**
 * Contador do perfil é COLUNA, não `COUNT(*)`.
 * A página do anunciante mostra "12 anúncios ativos" em toda listagem; contar
 * a cada render seria uma varredura por cartão exibido.
 */
function ajustarContadorDoPerfil(anuncio, { de, para }, transacao) {
  const ativo = (status) => STATUS_ATIVOS.includes(status);
  const delta = (ativo(para) ? 1 : 0) - (ativo(de) ? 1 : 0);
  if (!delta) return Promise.resolve();

  return db.Perfil.increment(
    { total_anuncios_ativos: delta },
    { where: { id: anuncio.perfil_id }, transaction: transacao }
  );
}

/** trilha do anúncio — visível a quem pode lê-lo fora da vitrine (dono e Admin) */
async function listar(contexto, id) {
  const anuncio = await acesso.paraAcao(contexto, id, 'anuncio.ler');

  return db.AnuncioHistorico.findAll({
    where: { anuncio_id: anuncio.id },
    include: [{ model: db.Usuario, as: 'ator', attributes: ['id', 'nome'] }],
    order: [['criado_em', 'DESC']],
    limit: 100,
  });
}

module.exports = { registrar, ajustarContadorDoPerfil, listar };
