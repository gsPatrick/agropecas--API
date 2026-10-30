'use strict';

const { Router } = require('express');
const controller = require('./pedido.controller');
const esquemas = require('./pedido.validators');
const { autenticar, autorizar, validar, rateLimit } = require('../../middlewares');

/**
 * Repasses do vendedor (`/v1/repasses`): o extrato (retido × disponível ×
 * pago) e a chave PIX para onde a plataforma transfere.
 */

const router = Router();
router.use(autenticar);

router.get('/', rateLimit.leitura(), autorizar('repasse.ler'), validar.query(esquemas.extrato), controller.extrato);
router.get('/chave-pix', rateLimit.leitura(), autorizar('repasse.configurar_pix'), controller.lerChavePix);
router.put(
  '/chave-pix',
  rateLimit.porAtor('chave-pix', { max: 5, janelaMs: 60 * 60 * 1000, mensagem: 'Muitas alterações de chave PIX. Tente mais tarde.' }),
  autorizar('repasse.configurar_pix'),
  validar(esquemas.chavePix),
  controller.salvarChavePix
);

module.exports = router;
