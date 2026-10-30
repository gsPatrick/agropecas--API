'use strict';

const checkoutService = require('./pedido.checkout.service');
const consultaService = require('./pedido.consulta.service');
const acoesService = require('./pedido.acoes.service');
const pagamentoService = require('./pedido.pagamento.service');
const repasseService = require('./pedido.repasse.service');
const mapper = require('./pedido.mapper');
const pagamento = require('../../providers/pagamento');
const filas = require('../../filas');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');
const { erros } = require('../../utils/erros');

/**
 * Controller — só HTTP. Quem decide se a peça é comprável, quem pode
 * confirmar e o que um pagamento muda são os services, que o job do webhook
 * e a liberação automática chamam do mesmo jeito.
 */

/** responde sempre com a visão do pedido que o ator tem direito de ver */
async function responderDetalhe(res, contexto, pedidoId, meta) {
  const { pedido, visao } = await consultaService.detalhar(contexto, pedidoId);
  return resposta.ok(res, mapper.pedido(pedido, { visao }), meta);
}

// ─── COMPRADOR ─────────────────────────────────────────────────

const checkout = catchAsync(async (req, res) => {
  const { pedido, checkoutUrl, reaproveitado } = await checkoutService.iniciar(req.contexto, req.body);
  const corpo = { pedido: mapper.pedido(pedido, { visao: 'comprador' }), checkoutUrl, reaproveitado };
  if (reaproveitado) return resposta.ok(res, corpo);
  return resposta.criado(res, corpo);
});

const compras = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await consultaService.listarCompras(req.contexto, req.query);
  resposta.paginado(res, mapper.lista(itens, { visao: 'comprador' }), { pagina, porPagina, total });
});

const vendas = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await consultaService.listarVendas(req.contexto, req.query);
  resposta.paginado(res, mapper.lista(itens, { visao: 'vendedor' }), { pagina, porPagina, total });
});

const detalhe = catchAsync(async (req, res) => responderDetalhe(res, req.contexto, req.params.id));

/**
 * Volta do checkout. Sem `pagamentoId` (o comprador fechou a aba do MP e
 * voltou pelo painel), devolve o pedido como está.
 */
const sincronizar = catchAsync(async (req, res) => {
  const { pedido } = await consultaService.detalhar(req.contexto, req.params.id);
  if (pedido.comprador_id !== req.contexto.usuarioId && !req.contexto.admin) throw erros.naoEncontrado('Pedido');

  if (req.body.pagamentoId) {
    await pagamentoService.sincronizarPagamento(req.body.pagamentoId, { origem: 'retorno', pedidoEsperado: pedido.id });
  }
  return responderDetalhe(res, req.contexto, pedido.id);
});

const confirmarRecebimento = catchAsync(async (req, res) => {
  await acoesService.confirmarRecebimento(req.contexto, req.params.id, req.body);
  return responderDetalhe(res, req.contexto, req.params.id, { mensagem: 'Recebimento confirmado. Obrigado!' });
});

const disputar = catchAsync(async (req, res) => {
  await acoesService.abrirDisputa(req.contexto, req.params.id, req.body);
  return responderDetalhe(res, req.contexto, req.params.id, { mensagem: 'Disputa aberta. Nossa equipe vai entrar em contato.' });
});

const cancelar = catchAsync(async (req, res) => {
  await acoesService.cancelar(req.contexto, req.params.id, req.body);
  return responderDetalhe(res, req.contexto, req.params.id, { mensagem: 'Pedido cancelado.' });
});

// ─── VENDEDOR ──────────────────────────────────────────────────

const extrato = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total, resumo } = await repasseService.extrato(req.contexto, req.query);
  res.status(200).json({
    sucesso: true,
    dados: itens.map(mapper.itemExtrato),
    meta: { pagina, porPagina, total, totalPaginas: Math.max(1, Math.ceil(total / porPagina)), resumo },
  });
});

const lerChavePix = catchAsync(async (req, res) => {
  resposta.ok(res, mapper.chavePix(await repasseService.lerChavePix(req.contexto)));
});

const salvarChavePix = catchAsync(async (req, res) => {
  const perfil = await repasseService.salvarChavePix(req.contexto, req.body);
  resposta.ok(res, mapper.chavePix(perfil), { mensagem: 'Chave PIX salva.' });
});

// ─── WEBHOOK ───────────────────────────────────────────────────

/**
 * Notificação do Mercado Pago.
 *
 * Assinatura conferida aqui, ANTES de qualquer trabalho; o processamento vai
 * para a fila e a resposta sai na hora — o MP espera 200 em até 22s e
 * reenvia o que não foi confirmado. Falha no processamento é retentada pela
 * fila, não pelo MP.
 *
 * Notificação de outro tópico (merchant_order, a IPN antiga) recebe 200 e é
 * ignorada: recusar faria o MP insistir nela para sempre.
 */
const webhook = catchAsync(async (req, res) => {
  const tipo = req.body?.type || req.query.type || req.query.topic;
  const dataId = req.query['data.id'] || req.body?.data?.id || req.query.id;

  const valida = await pagamento.assinaturaValida({
    xSignature: req.get('x-signature'),
    xRequestId: req.get('x-request-id'),
    dataId: req.query['data.id'] || req.body?.data?.id,
  });
  if (!valida) return res.status(401).json({ sucesso: false, erro: { codigo: 'ASSINATURA_INVALIDA', mensagem: 'Assinatura inválida.' } });

  if (tipo !== 'payment' || !dataId || !/^\d{1,20}$/.test(String(dataId))) {
    return res.status(200).json({ sucesso: true, dados: { ignorado: true } });
  }

  await filas.enfileirar(
    'pagamento.processarNotificacao',
    { pagamentoId: String(dataId) },
    /* o MP manda `payment.created` e `payment.updated` quase juntos: a chave
       por pagamento+ação evita processar a mesma notificação duas vezes */
    { chaveUnica: `mp-${dataId}-${req.body?.action || 'notificacao'}-${req.get('x-request-id') || ''}` }
  );

  return res.status(200).json({ sucesso: true, dados: { recebido: true } });
});

module.exports = {
  checkout,
  compras,
  vendas,
  detalhe,
  sincronizar,
  confirmarRecebimento,
  disputar,
  cancelar,
  extrato,
  lerChavePix,
  salvarChavePix,
  webhook,
};
