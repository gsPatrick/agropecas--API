'use strict';

const { Router } = require('express');
const controller = require('./contato.controller');
const esquemas = require('./contato.validators');
const {
  autenticar,
  autenticacaoOpcional,
  autorizar,
  validar,
  rateLimit,
} = require('../../middlewares');

/**
 * Mapa da feature. A linha em branco entre os blocos é regra de segurança, não
 * estética: tudo abaixo de `router.use(autenticar)` exige conta.
 *
 * A divisão entre os dois blocos é a decisão mais importante do módulo:
 *
 * - **registrar contato é aberto** (autenticação opcional). O visitante clica
 *   no WhatsApp e a plataforma precisa contar isso; exigir login aqui
 *   destruiria a métrica de quem não tem conta — que é maioria no lançamento —
 *   e o `anuncio_contatos.interessado_id` já nasce nulo justamente para esse
 *   caso. Registrar uma intenção não revela dado de ninguém;
 *
 * - **revelar contato exige conta.** Este endpoint DEVOLVE telefone de
 *   terceiro. Sem conta não há a quem aplicar cota nem a quem responsabilizar,
 *   e o resultado é uma API de exportação da base de anunciantes. A
 *   justificativa longa está em `documentacao/features/Contato.md`.
 *
 * O `rateLimit` do middleware genérico monta a chave com o caminho, que aqui
 * carrega o id do anúncio — ou seja, ele limita POR ANÚNCIO. Serve contra
 * flood na mesma URL e nada mais. A cota que realmente vale, por pessoa e
 * atravessando todos os anúncios, está em `contato.limite.service.js`.
 */

const router = Router();

// ─── aberto ao visitante ────────────────────────────────────────
router.post(
  '/anuncios/:anuncioId',
  rateLimit.escrita(),
  autenticacaoOpcional,
  validar.params(esquemas.anuncioNaRota),
  validar(esquemas.registrar),
  controller.registrar
);

// ─── exige conta ────────────────────────────────────────────────
router.use(autenticar);

router.post(
  '/anuncios/:anuncioId/revelar',
  rateLimit.escrita(),
  validar.params(esquemas.anuncioNaRota),
  validar(esquemas.revelar),
  controller.revelar
);

router.get(
  '/recebidos',
  rateLimit.leitura(),
  autorizar('anuncio.ver_contatos'),
  validar.query(esquemas.listarMeus),
  controller.meus
);

router.get(
  '/anuncios/:anuncioId/recebidos',
  rateLimit.leitura(),
  autorizar('anuncio.ver_contatos'),
  validar.params(esquemas.anuncioNaRota),
  validar.query(esquemas.listarRecebidos),
  controller.recebidos
);

router.get(
  '/anuncios/:anuncioId/metricas',
  rateLimit.leitura(),
  autorizar('anuncio.ver_metricas'),
  validar.params(esquemas.anuncioNaRota),
  validar.query(esquemas.metricas),
  controller.metricas
);

module.exports = router;
