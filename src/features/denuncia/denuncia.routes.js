'use strict';

const { Router } = require('express');
const controller = require('./denuncia.controller');
const esquemas = require('./denuncia.validators');
const { autenticar, autorizar, validar, rateLimit } = require('../../middlewares');

/**
 * Mapa da feature. Nenhuma rota é pública: denunciar exige conta, senão a fila
 * de moderação vira caixa de spam anônimo e não há a quem responder o desfecho.
 *
 * Ordem em toda rota: limite → autorização → validação → controller.
 *
 * `/minhas` vem ANTES de `/:id` de propósito — invertido, o Express casaria
 * "minhas" como identificador e a rota do usuário morreria em 422.
 */

const router = Router();

router.use(autenticar);

// ─── qualquer pessoa logada ─────────────────────────────────────
router.post(
  '/',
  rateLimit.escrita(),
  autorizar('denuncia.criar'),
  validar(esquemas.criar),
  controller.criar
);

router.get('/minhas', validar.query(esquemas.listar), controller.minhas);

// ─── moderação (escopo `todas` exigido no service) ──────────────
router.get('/', autorizar('denuncia.ler'), validar.query(esquemas.listar), controller.listar);

router.get(
  '/agrupadas',
  autorizar('denuncia.ler'),
  validar.query(esquemas.agrupadas),
  controller.agrupadas
);

router.get('/:id', validar.params(esquemas.identificador), controller.ver);

router.patch(
  '/:id/resolver',
  rateLimit.escrita(),
  autorizar('denuncia.resolver'),
  validar.params(esquemas.identificador),
  validar(esquemas.resolver),
  controller.resolver
);

module.exports = router;
