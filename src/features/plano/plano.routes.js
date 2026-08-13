'use strict';

const { Router } = require('express');
const controller = require('./plano.controller');
const esquemas = require('./plano.validators');
const {
  autenticar,
  autenticacaoOpcional,
  autorizar,
  validar,
  rateLimit,
} = require('../../middlewares');

/**
 * Mapa da feature de planos.
 *
 * A listagem é PÚBLICA de propósito: ela é a tabela de preços do site, e o
 * site precisa renderizá-la sem login. Hoje ela mostra um plano só, gratuito —
 * quando a monetização chegar, a mesma rota já serve a vitrine nova.
 *
 * Ordem dos middlewares: limite → validação → autenticação → autorização →
 * controller.
 */

const router = Router();

// ─── público (tabela de preços) ─────────────────────────────────
/* autenticação OPCIONAL: sem token a rota responde ao visitante; com token de
   Admin ela também devolve plano oculto e inativo, sem precisar de outra rota */
router.get(
  '/',
  rateLimit.leitura(),
  validar.query(esquemas.listagem),
  autenticacaoOpcional,
  controller.listar
);

// ─── autenticado ────────────────────────────────────────────────
router.use(autenticar);

/* antes de `/:id`: sem isto o Express casaria "minha-assinatura" como id e a
   validação de uuid devolveria 422 numa rota que existe */
router.get('/minha-assinatura', rateLimit.leitura(), controller.minhaAssinatura);
router.get('/minha-assinatura/historico', rateLimit.leitura(), controller.meuHistorico);
router.get(
  '/meus-limites/:chave',
  rateLimit.leitura(),
  validar.params(esquemas.chaveDeLimite),
  controller.meuLimite
);

router.get('/:id', rateLimit.leitura(), validar.params(esquemas.identificador), controller.obter);

// ─── administração ──────────────────────────────────────────────
router.post('/', rateLimit.escrita(), validar(esquemas.criar), autorizar('plano.criar'), controller.criar);

router.patch(
  '/:id',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.editar),
  autorizar('plano.editar'),
  controller.editar
);

router.put(
  '/:id/limites',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.definirLimites),
  autorizar('plano.editar'),
  controller.definirLimites
);

router.delete(
  '/:id',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  autorizar('plano.remover'),
  controller.remover
);

router.post(
  '/atribuir',
  rateLimit.escrita(),
  validar(esquemas.atribuir),
  autorizar('plano.atribuir'),
  controller.atribuir
);

module.exports = router;
