'use strict';

/**
 * Máquina de estados do pedido (Maturacao/06).
 *
 *   aguardando_pagamento ──► pago ──► entregue ──► concluido
 *          │                  │  ▲        │
 *          ▼                  ▼  │        ▼
 *      cancelado          em_disputa   reembolsado
 *          │                  │
 *          ▼                  ▼
 *        pago*           reembolsado
 *
 *  * pagamento aprovado DEPOIS de a reserva expirar: se ainda houver
 *    estoque o pedido revive; se não houver, é estornado.
 *
 * Status é máquina com transição validada, não booleano solto
 * (Maturacao/03, §1.4): "pago e cancelado ao mesmo tempo" não pode existir.
 */
const TRANSICOES = {
  aguardando_pagamento: ['pago', 'cancelado'],
  cancelado: ['pago', 'reembolsado'],
  pago: ['entregue', 'em_disputa', 'reembolsado'],
  em_disputa: ['entregue', 'reembolsado'],
  entregue: ['concluido', 'reembolsado'],
  concluido: ['reembolsado'],
  reembolsado: [],
};

/** status em que o dinheiro do comprador está na conta da plataforma */
const STATUS_COM_PAGAMENTO = ['pago', 'em_disputa', 'entregue', 'concluido'];

/** quem confirmou a entrega — vai para `entrega_confirmada_por` */
const CONFIRMADO_POR = { COMPRADOR: 'comprador', ADMIN: 'admin', SISTEMA: 'sistema' };

/* status do pagamento no MP que interessam à máquina */
const MP_APROVADO = 'approved';
const MP_ESTORNADO = ['refunded', 'charged_back'];

/** só peça vendida entra no checkout — serviço segue como classificado */
const NEGOCIACOES_COMPRAVEIS = ['venda', 'venda_ou_troca'];

const MAXIMO_QUANTIDADE = 99;
const MOTIVO_MAXIMO = 1000;

module.exports = {
  TRANSICOES,
  STATUS_COM_PAGAMENTO,
  CONFIRMADO_POR,
  MP_APROVADO,
  MP_ESTORNADO,
  NEGOCIACOES_COMPRAVEIS,
  MAXIMO_QUANTIDADE,
  MOTIVO_MAXIMO,
};
