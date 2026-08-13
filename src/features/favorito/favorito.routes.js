'use strict';

const { Router } = require('express');
const controller = require('./favorito.controller');
const esquemas = require('./favorito.validators');
const { autenticar, autorizar, validar, rateLimit } = require('../../middlewares');

/**
 * Mapa da feature.
 *
 * **Nenhuma rota é pública.** Favorito só existe atrelado a uma conta: sem
 * login não há lista para ler nem para escrever, e um endpoint anônimo aqui
 * seria apenas um jeito de inflar `total_favoritos` de graça.
 *
 * Ordem dos middlewares: limite → autorização → validação → controller.
 * Limitar antes de tudo evita gastar CPU com requisição que já seria recusada.
 */

const router = Router();

router.use(autenticar);

// ─── minha lista ────────────────────────────────────────────────
router.get(
  '/',
  rateLimit.leitura(),
  autorizar('favorito.ler'),
  validar.query(esquemas.listar),
  controller.listar
);

router.post(
  '/',
  rateLimit.escrita(),
  autorizar('favorito.gerenciar'),
  validar(esquemas.salvar),
  controller.salvar
);

/**
 * Checagem em lote — POST porque a entrada é uma lista de até 120 UUIDs, o
 * que passa fácil do limite prático de uma query string. Não escreve nada,
 * mas usa o limite de leitura pelo mesmo motivo: é chamada uma vez por tela.
 */
router.post(
  '/marcados',
  rateLimit.leitura(),
  autorizar('favorito.ler'),
  validar(esquemas.marcados),
  controller.marcados
);

router.delete(
  '/:anuncioId',
  rateLimit.escrita(),
  autorizar('favorito.gerenciar'),
  validar.params(esquemas.identificadorAnuncio),
  controller.remover
);

// ─── métrica do anúncio (para o dono) ───────────────────────────
router.get(
  '/anuncios/:anuncioId/contador',
  rateLimit.leitura(),
  validar.params(esquemas.identificadorAnuncio),
  controller.contador
);

/**
 * Lista de terceiro.
 *
 * Existe para apuração (denúncia de conta que salva anúncio em massa para
 * revenda) e exige `favorito.ler.todos`. O escopo é conferido no service, com
 * o dono em mãos — o `autorizar` da rota só barra quem não pode ler nem a
 * própria lista.
 */
router.get(
  '/usuarios/:usuarioId',
  rateLimit.leitura(),
  autorizar('favorito.ler'),
  validar.params(esquemas.identificadorUsuario),
  validar.query(esquemas.listar),
  controller.listarDeUsuario
);

module.exports = router;
