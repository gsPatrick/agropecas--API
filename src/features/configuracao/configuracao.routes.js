'use strict';

const { Router } = require('express');
const controller = require('./configuracao.controller');
const esquemas = require('./configuracao.validators');
const { autenticar, autorizar, validar, rateLimit } = require('../../middlewares');

/**
 * Mapa da feature.
 *
 * Uma rota aberta e o resto fechado atrás de `configuracao.ler` /
 * `configuracao.editar`. A rota aberta vem ANTES do `router.use(autenticar)` —
 * a ordem aqui é a regra de segurança, então a linha em branco que separa os
 * dois blocos não é estética.
 *
 * `/publicas` tem rate limit de leitura porque é chamada em todo carregamento
 * do front (é ela que diz se o chat está ligado e qual o WhatsApp do suporte);
 * sem limite, vira o endpoint mais fácil de martelar do sistema.
 */

const router = Router();

// ─── público (lista branca em configuracao.constants.js) ────────
router.get('/publicas', rateLimit.leitura(), controller.publicas);

// ─── autenticado ────────────────────────────────────────────────
router.use(autenticar);

router.get('/', autorizar('configuracao.ler'), validar.query(esquemas.listar), controller.listar);

router.put(
  '/',
  rateLimit.escrita(),
  autorizar('configuracao.editar'),
  validar(esquemas.definirVarias),
  controller.definirVarias
);

router.get(
  '/:chave',
  autorizar('configuracao.ler'),
  validar.params(esquemas.identificadorChave),
  controller.obter
);

router.get(
  '/:chave/historico',
  autorizar('configuracao.ler'),
  validar.params(esquemas.identificadorChave),
  validar.query(esquemas.paginacao),
  controller.historico
);

router.put(
  '/:chave',
  rateLimit.escrita(),
  autorizar('configuracao.editar'),
  validar.params(esquemas.identificadorChave),
  validar(esquemas.definir),
  controller.definir
);

module.exports = router;
