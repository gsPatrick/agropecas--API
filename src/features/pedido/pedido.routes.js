'use strict';

const { Router } = require('express');
const controller = require('./pedido.controller');
const esquemas = require('./pedido.validators');
const { autenticar, autorizar, validar, rateLimit } = require('../../middlewares');

/**
 * Pedidos (`/v1/pedidos`) — o lado do comprador e do vendedor.
 * A visão financeira da Admin fica em `/v1/admin/vendas` e `/v1/admin/repasses`.
 *
 * Nenhuma rota é pública: compra exige conta (o pedido precisa de um dono
 * para confirmar recebimento e receber estorno).
 *
 * Ordem: limite → autorização → validação → controller.
 */

const router = Router();
router.use(autenticar);

router.post(
  '/checkout',
  /* cada checkout reserva estoque e cria preferência no MP — cota curta
     por pessoa impede que alguém "segure" todas as peças de uma loja */
  rateLimit.porAtor('checkout', { max: 20, janelaMs: 10 * 60 * 1000, mensagem: 'Muitas tentativas de compra. Aguarde alguns minutos.' }),
  autorizar('pedido.comprar'),
  validar(esquemas.checkout),
  controller.checkout
);

router.get('/compras', rateLimit.leitura(), autorizar('pedido.ler'), validar.query(esquemas.listar), controller.compras);
router.get('/vendas', rateLimit.leitura(), autorizar('pedido.ler'), validar.query(esquemas.listar), controller.vendas);

router.get('/:id', rateLimit.leitura(), autorizar('pedido.ler'), validar.params(esquemas.identificador), controller.detalhe);

router.post(
  '/:id/sincronizar',
  rateLimit.escrita(),
  autorizar('pedido.ler'),
  validar.params(esquemas.identificador),
  validar(esquemas.sincronizar),
  controller.sincronizar
);

router.post(
  '/:id/confirmar-recebimento',
  rateLimit.escrita(),
  autorizar('pedido.confirmar_recebimento'),
  validar.params(esquemas.identificador),
  validar(esquemas.motivoOpcional),
  controller.confirmarRecebimento
);

router.post(
  '/:id/disputa',
  rateLimit.escrita(),
  autorizar('pedido.disputar'),
  validar.params(esquemas.identificador),
  validar(esquemas.motivoObrigatorio),
  controller.disputar
);

router.post(
  '/:id/cancelar',
  rateLimit.escrita(),
  autorizar('pedido.cancelar'),
  validar.params(esquemas.identificador),
  validar(esquemas.motivoOpcional),
  controller.cancelar
);

module.exports = router;
