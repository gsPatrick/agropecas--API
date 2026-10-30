'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const pagamento = require('../../providers/pagamento');
const auditoria = require('../auditoria');
const { escopoDe } = require('../../rbac');
const { erros } = require('../../utils/erros');
const estado = require('./pedido.estado.service');
const estoque = require('./pedido.estoque');
const aviso = require('./pedido.aviso');
const { CONFIRMADO_POR } = require('./pedido.constants');

/**
 * Ações sobre um pedido existente: confirmar recebimento, disputar,
 * cancelar, estornar — e as duas rotinas automáticas (reserva vencida e
 * liberação em 7 dias).
 *
 * Quem pode o quê:
 *   comprador        confirma, disputa, cancela o que ainda não pagou
 *   Admin (`.todos`) confirma ("Liberar repasse"), cancela, estorna
 *   vendedor         nada aqui — ele não decide sobre o próprio dinheiro
 */

/**
 * Carrega e confere que o ator age sobre ESTE pedido como COMPRADOR, ou tem
 * o escopo `todos` da ação. O vendedor não passa: confirmar a própria
 * entrega liberaria o próprio saldo.
 *
 * @returns {{ pedido, comoAdmin: boolean }}
 */
async function exigirAtor(contexto, pedidoId, acao, transacao) {
  const escopo = escopoDe(contexto, acao);
  if (!escopo) throw erros.semPermissao(undefined, { permissao: acao });

  const pedido = await estado.travar(pedidoId, transacao);
  if (!pedido) throw erros.naoEncontrado('Pedido');

  if (escopo === 'todos') return { pedido, comoAdmin: true };
  /* 404 e não 403 para pedido alheio: não confirma que o id existe */
  if (pedido.comprador_id !== contexto.usuarioId) throw erros.naoEncontrado('Pedido');
  return { pedido, comoAdmin: false };
}

/**
 * Recebimento confirmado → repasse `disponivel`.
 *
 * É o mesmo efeito para os três caminhos (comprador, botão "Liberar repasse"
 * da Admin, e a liberação automática); muda só quem assina no histórico.
 */
async function aplicarEntrega(pedido, { contexto, por, motivo, transacao }) {
  const agora = new Date();
  await estado.transicionar(pedido, 'entregue', {
    contexto,
    motivo,
    campos: {
      entregue_em: agora,
      entrega_confirmada_por: por,
      liberacao_automatica_em: null,
    },
    transacao,
    origem: por === CONFIRMADO_POR.SISTEMA ? 'sistema' : undefined,
  });

  await db.Repasse.update(
    { status: 'disponivel', disponivel_em: agora },
    { where: { pedido_id: pedido.id, status: 'retido' }, transaction: transacao }
  );
}

async function confirmarRecebimento(contexto, pedidoId, { motivo } = {}) {
  let comoAdmin = false;
  const pedido = await db.sequelize.transaction(async (transacao) => {
    const alvo = await exigirAtor(contexto, pedidoId, 'pedido.confirmar_recebimento', transacao);
    comoAdmin = alvo.comoAdmin && alvo.pedido.comprador_id !== contexto.usuarioId;

    /* a disputa só a Admin encerra — o comprador que abriu não "desabre"
       sozinho por engano no mesmo botão */
    if (alvo.pedido.status === 'em_disputa' && !comoAdmin) {
      throw erros.conflito('Este pedido está em disputa. A equipe AgroPeças vai concluir a análise.');
    }

    await aplicarEntrega(alvo.pedido, {
      contexto,
      por: comoAdmin ? CONFIRMADO_POR.ADMIN : CONFIRMADO_POR.COMPRADOR,
      motivo: motivo || (comoAdmin ? 'repasse liberado pela administração' : 'recebimento confirmado pelo comprador'),
      transacao,
    });
    return alvo.pedido;
  });

  await aviso.entregue(pedido);
  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: 'pedidos',
    entidadeId: pedido.id,
    depois: { status: 'entregue', confirmadoPor: pedido.entrega_confirmada_por },
    motivo: motivo || null,
  });
  return pedido;
}

/**
 * Disputa: suspende a liberação automática. Quem resolve é a Admin —
 * liberando o repasse ou estornando o comprador.
 */
async function abrirDisputa(contexto, pedidoId, { motivo }) {
  const pedido = await db.sequelize.transaction(async (transacao) => {
    const { pedido: alvo } = await exigirAtor(contexto, pedidoId, 'pedido.disputar', transacao);
    if (alvo.comprador_id !== contexto.usuarioId) throw erros.naoEncontrado('Pedido');

    await estado.transicionar(alvo, 'em_disputa', {
      contexto,
      motivo,
      campos: { disputa_aberta_em: new Date(), disputa_motivo: motivo, liberacao_automatica_em: null },
      transacao,
    });
    return alvo;
  });

  await aviso.disputa(pedido);
  return pedido;
}

async function cancelar(contexto, pedidoId, { motivo } = {}) {
  const pedido = await db.sequelize.transaction(async (transacao) => {
    const { pedido: alvo } = await exigirAtor(contexto, pedidoId, 'pedido.cancelar', transacao);

    if (alvo.status !== 'aguardando_pagamento') {
      throw erros.conflito('Só dá para cancelar um pedido que ainda não foi pago. Para estorno, fale com o suporte.');
    }

    await estoque.devolver(alvo, transacao);
    await estado.transicionar(alvo, 'cancelado', {
      contexto,
      motivo: motivo || 'cancelado antes do pagamento',
      campos: { cancelado_em: new Date(), cancelamento_motivo: motivo || null, reservado_ate: null },
      transacao,
    });
    return alvo;
  });

  await estoque.invalidarAnuncio(pedido.anuncio_id);
  return pedido;
}

/**
 * Estorno pela Admin.
 *
 * A chamada ao MP vem PRIMEIRO e o pedido só muda depois que ela respondeu:
 * marcar `reembolsado` e o MP falhar deixaria o comprador sem dinheiro e o
 * sistema dizendo que devolveu. O fechamento do pedido é a mesma rotina do
 * webhook (`sincronizarPagamento`), então estorno pelo sistema e estorno
 * pelo painel do MP produzem exatamente o mesmo estado.
 */
async function reembolsar(contexto, pedidoId, { motivo }) {
  const alvo = await db.Pedido.findByPk(pedidoId);
  if (!alvo) throw erros.naoEncontrado('Pedido');
  if (escopoDe(contexto, 'pedido.reembolsar') !== 'todos') throw erros.semPermissao();

  if (!alvo.mp_pagamento_id || !estado.podeIr(alvo.status, 'reembolsado') || alvo.status === 'cancelado') {
    throw erros.conflito('Este pedido não tem pagamento a estornar.');
  }

  const repasse = await db.Repasse.findOne({ where: { pedido_id: alvo.id } });
  if (repasse?.status === 'pago') {
    throw erros.conflito('O repasse desta venda já foi pago ao vendedor. Resolva com o vendedor antes de estornar.');
  }

  await pagamento.estornar(alvo.mp_pagamento_id, {
    idempotencia: `estorno-${alvo.mp_pagamento_id}`,
    contaId: alvo.conta_mp_id,
  });

  const { sincronizarPagamento } = require('./pedido.pagamento.service');
  await sincronizarPagamento(alvo.mp_pagamento_id, { origem: 'admin', pedidoEsperado: alvo.id });

  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: 'pedidos',
    entidadeId: alvo.id,
    depois: { status: 'reembolsado' },
    motivo,
  });

  return alvo.reload();
}

// ─── ROTINAS ──────────────────────────────────────────────────────

/**
 * Reserva vencida sem pagamento → cancelado, estoque de volta.
 *
 * Pix gerado e pago depois disso ainda é tratado: ver
 * `aprovadoAposCancelamento` no service de pagamento.
 */
async function expirarReservas({ lote = 200 } = {}) {
  const vencidos = await db.Pedido.findAll({
    where: { status: 'aguardando_pagamento', reservado_ate: { [Op.lt]: new Date() } },
    attributes: ['id'],
    limit: lote,
  });

  let expirados = 0;
  const anuncios = new Set();

  for (const { id } of vencidos) {
    await db.sequelize.transaction(async (transacao) => {
      const pedido = await estado.travar(id, transacao);
      /* o webhook pode ter pago entre a busca e a trava */
      if (!pedido || pedido.status !== 'aguardando_pagamento') return;
      await estoque.devolver(pedido, transacao);
      await estado.transicionar(pedido, 'cancelado', {
        motivo: 'prazo de pagamento encerrado',
        campos: { cancelado_em: new Date(), cancelamento_motivo: 'prazo de pagamento encerrado', reservado_ate: null },
        transacao,
        origem: 'sistema',
      });
      anuncios.add(pedido.anuncio_id);
      expirados += 1;
    });
  }

  for (const anuncioId of anuncios) await estoque.invalidarAnuncio(anuncioId);
  return { expirados };
}

/**
 * 7 dias depois do pagamento, sem confirmação e sem disputa → libera.
 * Pedido em disputa não tem `liberacao_automatica_em` e nunca entra aqui.
 */
async function liberarAutomaticamente({ lote = 200 } = {}) {
  const vencidos = await db.Pedido.findAll({
    where: { status: 'pago', liberacao_automatica_em: { [Op.lt]: new Date() } },
    attributes: ['id'],
    limit: lote,
  });

  const liberados = [];
  for (const { id } of vencidos) {
    const pedido = await db.sequelize.transaction(async (transacao) => {
      const alvo = await estado.travar(id, transacao);
      if (!alvo || alvo.status !== 'pago') return null;
      await aplicarEntrega(alvo, {
        contexto: null,
        por: CONFIRMADO_POR.SISTEMA,
        motivo: 'liberação automática: prazo sem confirmação nem disputa do comprador',
        transacao,
      });
      return alvo;
    });
    if (pedido) {
      liberados.push(pedido.id);
      await aviso.entregue(pedido);
    }
  }

  return { liberados: liberados.length };
}

module.exports = {
  confirmarRecebimento,
  abrirDisputa,
  cancelar,
  reembolsar,
  expirarReservas,
  liberarAutomaticamente,
};
