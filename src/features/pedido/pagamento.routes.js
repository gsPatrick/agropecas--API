'use strict';

const { Router } = require('express');
const controller = require('./pedido.controller');

/**
 * Entrada pública do Mercado Pago (`/v1/pagamentos`).
 *
 * Sem `autenticar` — quem chama é o MP. A proteção é a assinatura
 * `x-signature` (conferida no controller) e, por cima dela, a regra de que
 * nada é aceito sem reconsultar o pagamento na API do MP.
 *
 * Sem rate limit por IP: os IPs do MP são poucos e compartilhados, e
 * limitar aqui derrubaria notificação legítima em dia de muitas vendas.
 */

const router = Router();

router.post('/webhook', controller.webhook);

module.exports = router;
