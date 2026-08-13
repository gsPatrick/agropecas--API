'use strict';

const { Router } = require('express');
const controller = require('./moderacao.controller');
const esquemas = require('./moderacao.validators');
const { autenticar, autorizar, validar, rateLimit } = require('../../middlewares');

/**
 * Mapa da feature. Tudo autenticado, tudo com capacidade declarada.
 *
 * `autorizar()` cobre só a CAPACIDADE — e o usuário comum tem
 * `anuncio.ler.proprio`, que a capacidade não distingue. O escopo `todos` é
 * exigido dentro dos services (`moderacao.comum.js → exigirEscopoTotal`), onde
 * a decisão pode ser tomada com o registro em mãos. Middleware que fingisse
 * checar escopo daria falsa sensação de proteção.
 *
 * Toda rota de escrita tem `rateLimit.escrita()`: são ações com efeito sobre a
 * conta de outra pessoa, e um script com token de moderador vazado não pode
 * banir a base inteira em um minuto.
 */

const router = Router();

router.use(autenticar);

// ─── painel e fila ──────────────────────────────────────────────
router.get('/painel', autorizar('denuncia.ler'), controller.painel);

router.get('/fila', autorizar('anuncio.ler'), validar.query(esquemas.fila), controller.fila);

router.get(
  '/anuncios/:id',
  autorizar('anuncio.ler'),
  validar.params(esquemas.identificador),
  controller.verAnuncio
);

// ─── decisões sobre anúncio ─────────────────────────────────────
router.post(
  '/anuncios/:id/aprovar',
  rateLimit.escrita(),
  autorizar('anuncio.aprovar'),
  validar.params(esquemas.identificador),
  validar(esquemas.aprovar),
  controller.aprovar
);

router.post(
  '/anuncios/:id/reprovar',
  rateLimit.escrita(),
  autorizar('anuncio.reprovar'),
  validar.params(esquemas.identificador),
  validar(esquemas.reprovar),
  controller.reprovar
);

router.post(
  '/anuncios/:id/ocultar',
  rateLimit.escrita(),
  autorizar('anuncio.ocultar'),
  validar.params(esquemas.identificador),
  validar(esquemas.ocultar),
  controller.ocultar
);

router.post(
  '/fotos/:id/bloquear',
  rateLimit.escrita(),
  autorizar('anuncio_foto.bloquear'),
  validar.params(esquemas.identificador),
  validar(esquemas.bloquearFoto),
  controller.bloquearFoto
);

// ─── sanções de conta ───────────────────────────────────────────
router.post(
  '/usuarios/:id/suspender',
  rateLimit.escrita(),
  autorizar('usuario.suspender'),
  validar.params(esquemas.identificador),
  validar(esquemas.suspender),
  controller.suspender
);

router.post(
  '/usuarios/:id/banir',
  rateLimit.escrita(),
  autorizar('usuario.banir'),
  validar.params(esquemas.identificador),
  validar(esquemas.banir),
  controller.banir
);

router.post(
  '/usuarios/:id/restaurar',
  rateLimit.escrita(),
  autorizar('usuario.restaurar'),
  validar.params(esquemas.identificador),
  validar(esquemas.restaurar),
  controller.restaurar
);

// ─── histórico ──────────────────────────────────────────────────
router.get(
  '/anuncios/:id/historico',
  autorizar('anuncio.ler'),
  validar.params(esquemas.identificador),
  validar.query(esquemas.paginacao),
  controller.historicoAnuncio
);

router.get(
  '/usuarios/:id/historico',
  autorizar('usuario.ler'),
  validar.params(esquemas.identificador),
  validar.query(esquemas.paginacao),
  controller.historicoUsuario
);

module.exports = router;
