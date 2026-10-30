'use strict';

const { registrar } = require('../registro');
const { FILAS } = require('../definicoes');

/**
 * Trabalhos do fluxo de compra (Maturacao/06).
 *
 * Services carregados dentro do executor, como nos demais trabalhos: o boot
 * das filas não pode puxar models e SDK de pagamento antes da hora.
 */

/**
 * Notificação de pagamento já com assinatura conferida. Reconsulta o
 * pagamento no MP e aplica ao pedido — idempotente, pode rodar N vezes.
 * Falha de rede com o MP lança, e a fila retenta com espera crescente.
 */
const PROCESSAR_NOTIFICACAO = registrar(
  'pagamento.processarNotificacao',
  async ({ pagamentoId }) => {
    const { sincronizarPagamento } = require('../../features/pedido/pedido.pagamento.service');
    return sincronizarPagamento(pagamentoId, { origem: 'webhook' });
  },
  { fila: FILAS.PAGAMENTO.nome }
);

const EXPIRAR_RESERVAS = registrar(
  'pedido.expirarReservas',
  async (dados = {}) => require('../../features/pedido/pedido.acoes.service').expirarReservas(dados),
  { fila: FILAS.MANUTENCAO.nome }
);

const LIBERAR_AUTOMATICAMENTE = registrar(
  'pedido.liberarAutomaticamente',
  async (dados = {}) => require('../../features/pedido/pedido.acoes.service').liberarAutomaticamente(dados),
  { fila: FILAS.MANUTENCAO.nome }
);

module.exports = { PROCESSAR_NOTIFICACAO, EXPIRAR_RESERVAS, LIBERAR_AUTOMATICAMENTE };
