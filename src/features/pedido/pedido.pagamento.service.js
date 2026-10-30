'use strict';

const db = require('../../models');
const config = require('../../config');
const pagamento = require('../../providers/pagamento');
const auditoria = require('../auditoria');
const { erros } = require('../../utils/erros');
const estado = require('./pedido.estado.service');
const estoque = require('./pedido.estoque');
const aviso = require('./pedido.aviso');
const { MP_APROVADO, MP_ESTORNADO, STATUS_COM_PAGAMENTO } = require('./pedido.constants');

/**
 * Aplica ao pedido o que o Mercado Pago diz sobre um pagamento.
 *
 * Entra por dois caminhos, e os dois terminam aqui:
 *   · webhook (`pagamento.processarNotificacao`) — o caminho principal;
 *   · volta do checkout (`POST /pedidos/:id/sincronizar`) — rede de
 *     segurança para webhook atrasado, perdido, ou ambiente sem URL pública.
 *
 * Em nenhum deles o dado de entrada é confiado: só o id do pagamento é usado,
 * e o status, o valor e o pedido vêm da consulta à API do MP.
 *
 * **Idempotente.** O MP reenvia a mesma notificação várias vezes, e webhook e
 * sincronização chegam juntos. O pedido é travado (`FOR UPDATE`) e a máquina
 * de estados só deixa cada transição acontecer uma vez — a segunda chamada
 * encontra o pedido já `pago` e não faz nada.
 */

const adicionarDias = (dias, base = new Date()) => new Date(base.getTime() + dias * 24 * 60 * 60 * 1000);

/** pedido do pagamento: pela referência e, sem ela, pelo id já gravado */
async function localizarPedidoId(dados) {
  if (dados.referencia) return dados.referencia;
  const pedido = await db.Pedido.findOne({ where: { mp_pagamento_id: dados.id }, attributes: ['id'] });
  return pedido?.id || null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pago → cria o saldo retido do vendedor.
 *
 * `findOrCreate` sobre o índice único de `pedido_id`: mesmo que duas
 * transações chegassem aqui, o banco garante um repasse por venda.
 */
async function registrarPago(pedido, dados, transacao, origem) {
  const agora = new Date();
  await estado.transicionar(pedido, 'pago', {
    motivo: `pagamento ${dados.id} aprovado (${origem})`,
    campos: {
      pago_em: dados.aprovadoEm || agora,
      liberacao_automatica_em: adicionarDias(config.pagamento.liberacaoAutomaticaDias, agora),
      reservado_ate: null,
    },
    dados: { pagamentoId: dados.id, metodo: dados.metodo },
    transacao,
    origem,
  });

  await db.Repasse.findOrCreate({
    where: { pedido_id: pedido.id },
    defaults: {
      pedido_id: pedido.id,
      vendedor_id: pedido.vendedor_id,
      valor_centavos: pedido.valor_vendedor_centavos,
      status: 'retido',
    },
    transaction: transacao,
  });
}

/**
 * Estorno ou chargeback vindo do MP (inclusive aberto pelo painel do MP, fora
 * do sistema). O repasse ainda não pago é cancelado; se JÁ foi pago, fica
 * como está e o histórico registra — a Admin precisa cobrar o vendedor, e
 * apagar o rastro do PIX esconderia isso.
 */
async function registrarEstorno(pedido, dados, transacao, origem) {
  const antes = pedido.status;
  const repasse = await db.Repasse.findOne({ where: { pedido_id: pedido.id }, transaction: transacao });
  const repasseJaPago = repasse?.status === 'pago';

  await estado.transicionar(pedido, 'reembolsado', {
    motivo: `pagamento ${dados.id} ${dados.status} (${origem})`,
    campos: { reembolsado_em: new Date(), liberacao_automatica_em: null },
    dados: { pagamentoId: dados.id, repasseJaPago },
    transacao,
    origem,
  });

  if (repasse && !repasseJaPago) {
    await repasse.update({ status: 'cancelado' }, { transaction: transacao });
  }

  /* a peça não chegou a ser entregue: volta para o anúncio */
  if (['pago', 'em_disputa'].includes(antes)) await estoque.devolver(pedido, transacao);
}

/**
 * Pagamento aprovado DEPOIS de a reserva expirar (Pix pago no último
 * minuto, por exemplo). Tenta reservar de novo; se a peça já foi vendida a
 * outro, estorna sozinho — o comprador não pode ficar pagando por nada.
 *
 * @returns {'revivido'|'estornar'}
 */
async function aprovadoAposCancelamento(pedido, transacao) {
  const reserva = await estoque.reservar(pedido.anuncio_id, pedido.quantidade, transacao);
  if (reserva === 'esgotado') return 'estornar';
  await pedido.update({ estoque_reservado: reserva === 'reservado' }, { transaction: transacao });
  return 'revivido';
}

/**
 * @param pagamentoId  id do pagamento no MP
 * @param opcoes.origem      'webhook' | 'retorno' | 'admin'
 * @param opcoes.pedidoEsperado  quando chamado a partir de um pedido, recusa
 *                         pagamento que pertence a outro
 * @returns {{ pedidoId, status, acao }}
 */
async function sincronizarPagamento(pagamentoId, { origem = 'webhook', pedidoEsperado } = {}) {
  const dados = await pagamento.consultarPagamento(pagamentoId);
  if (!dados) return { acao: 'pagamento_inexistente' };

  const pedidoId = await localizarPedidoId(dados);
  if (!pedidoId || !UUID.test(pedidoId)) return { acao: 'sem_pedido' };
  if (pedidoEsperado && pedidoEsperado !== pedidoId) {
    throw erros.invalido('Este pagamento não pertence a este pedido.');
  }

  let efeito = null;
  let estornarAgora = false;

  const pedido = await db.sequelize.transaction(async (transacao) => {
    const atual = await estado.travar(pedidoId, transacao);
    if (!atual) return null;

    /* o valor pago tem que ser o valor do pedido. Diferente = alguém
       mexeu na preferência ou é pagamento de outra coisa: não libera nada */
    if (dados.status === MP_APROVADO && (dados.valorCentavos !== Number(atual.valor_total_centavos) || dados.moeda !== 'BRL')) {
      console.error('[pedido] valor do pagamento diverge do pedido', {
        pedidoId,
        pagamentoId: dados.id,
        pago: dados.valorCentavos,
        esperado: Number(atual.valor_total_centavos),
      });
      await atual.update({ mp_status: 'valor_divergente', mp_pagamento_id: dados.id }, { transaction: transacao });
      efeito = 'valor_divergente';
      return atual;
    }

    /* um pedido, um pagamento: depois de pago, só o pagamento que pagou
       pode mudar o estado (outra tentativa recusada não interessa) */
    if (atual.mp_pagamento_id && atual.mp_pagamento_id !== dados.id && STATUS_COM_PAGAMENTO.includes(atual.status)) {
      efeito = 'outro_pagamento';
      return atual;
    }

    await atual.update(
      {
        mp_pagamento_id: dados.id,
        mp_status: dados.status,
        mp_status_detalhe: dados.statusDetalhe,
        mp_metodo: dados.metodo,
      },
      { transaction: transacao }
    );

    if (dados.status === MP_APROVADO) {
      if (atual.status === 'aguardando_pagamento') {
        await registrarPago(atual, dados, transacao, origem);
        efeito = 'pago';
      } else if (atual.status === 'cancelado') {
        if ((await aprovadoAposCancelamento(atual, transacao)) === 'revivido') {
          await registrarPago(atual, dados, transacao, origem);
          efeito = 'pago';
        } else {
          estornarAgora = true;
        }
      }
    } else if (MP_ESTORNADO.includes(dados.status) && estado.podeIr(atual.status, 'reembolsado')) {
      await registrarEstorno(atual, dados, transacao, origem);
      efeito = 'reembolsado';
    }

    return atual;
  });

  if (!pedido) return { acao: 'sem_pedido' };

  if (efeito === 'pago') {
    await estoque.invalidarAnuncio(pedido.anuncio_id);
    await aviso.pago(pedido);
    await auditoria.registrar(null, {
      acao: 'editar',
      entidade: 'pedidos',
      entidadeId: pedido.id,
      depois: { status: 'pago', pagamentoId: dados.id, valorCentavos: dados.valorCentavos },
      motivo: `pagamento aprovado (${origem})`,
    });
  }
  if (efeito === 'reembolsado') {
    await estoque.invalidarAnuncio(pedido.anuncio_id);
    await aviso.reembolsado(pedido);
  }

  if (estornarAgora) {
    /* fora da transação: é chamada externa. O webhook de `refunded` que o
       MP manda em seguida é o que fecha o pedido como `reembolsado` */
    await pagamento.estornar(dados.id, { idempotencia: `estorno-${dados.id}`, contaId: dados.contaId });
    efeito = 'estornado_sem_estoque';
  }

  return { pedidoId: pedido.id, status: pedido.status, acao: efeito || 'sem_mudanca' };
}

module.exports = { sincronizarPagamento };
