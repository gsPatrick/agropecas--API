'use strict';

const { Router } = require('express');
const controller = require('./busca.controller');
const esquemas = require('./busca.validators');
const { validar, rateLimit, autenticacaoOpcional } = require('../../middlewares');

/**
 * Rotas da busca. Todas PÚBLICAS — encontrar peça é o que o visitante faz
 * antes de decidir se cria conta, e exigir login aqui mataria o produto.
 *
 * ─── por que rate limit em rota de leitura ───
 *
 * Esta é a rota mais raspável do sistema: um script de duas linhas percorre
 * `?p=1..N` e leva o catálogo inteiro — quem anuncia, onde mora, quanto cobra.
 * O limite não impede a raspagem determinada, mas transforma "cinco minutos"
 * em "um dia", que é tempo suficiente para alguém notar.
 *
 * Os tetos são diferentes por rota porque o custo é diferente:
 *  • busca      — 120/min: uma pessoa navegando faz ~10; 120 já é generoso.
 *  • facetas    — 60/min: agregação, mais cara que a lista.
 *  • sugestões  — 240/min: é chamada A CADA TECLA, e o front faz debounce.
 *  • populares  — 120/min: serve do cache quase sempre.
 *
 * `autenticacaoOpcional` antes de tudo: quem está logado tem a busca
 * registrada com `usuario_id` (e o limite conta por sessão, não pelo IP da
 * operadora que a cidade inteira compartilha), e quem não está segue normal.
 *
 * Ordem dos middlewares, igual ao resto do projeto: limite → validação →
 * autenticação → controller.
 */

const router = Router();

router.use(autenticacaoOpcional);

router.get(
  '/',
  rateLimit({ max: 120, janelaMs: 60 * 1000, mensagem: 'Muitas buscas seguidas. Aguarde um instante.' }),
  validar.query(esquemas.buscar),
  controller.buscar
);

router.get(
  '/facetas',
  rateLimit({ max: 60, janelaMs: 60 * 1000 }),
  validar.query(esquemas.buscar),
  controller.facetas
);

router.get(
  '/sugestoes',
  rateLimit({ max: 240, janelaMs: 60 * 1000 }),
  validar.query(esquemas.sugerir),
  controller.sugerir
);

router.get(
  '/termos-populares',
  rateLimit.leitura(),
  validar.query(esquemas.termosPopulares),
  controller.populares
);

/* escrita (grava o clique no log), por isso o limite mais apertado */
router.post(
  '/clique',
  rateLimit.escrita(),
  validar(esquemas.registrarClique),
  controller.registrarClique
);

module.exports = router;
