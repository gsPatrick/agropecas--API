'use strict';

const { Router } = require('express');
const controller = require('./anuncio.controller');
const esquemas = require('./anuncio.validators');
const {
  autenticar,
  autenticacaoOpcional,
  autorizar,
  validar,
  rateLimit,
} = require('../../middlewares');

/**
 * Mapa da feature: o que existe, quem pode e o que é validado, sem abrir mais
 * nenhum arquivo.
 *
 * Ordem em toda rota: limite → validação → autenticação → autorização →
 * controller. Limitar antes de validar evita gastar CPU com requisição que já
 * seria recusada.
 *
 * **A vitrine e o detalhe são públicos** — é o produto: o produtor procura peça
 * no celular e só faz conta quando decide conversar (Maturacao/05, §4). Ambos
 * usam `autenticacaoOpcional`, porque a página muda para quem está logado
 * (botão de chat, favorito marcado) sem exigir login para existir.
 *
 * A **capacidade** é conferida aqui; o **escopo** (dono × todos) é conferido no
 * service, onde o dono do registro é conhecido. Middleware que fingisse checar
 * escopo daria falsa sensação de proteção.
 */

const router = Router();

// ─── público ────────────────────────────────────────────────────
router.get(
  '/',
  rateLimit.leitura(),
  validar.query(esquemas.listar),
  autenticacaoOpcional,
  controller.listar
);

// ─── autenticado ────────────────────────────────────────────────
/* declarado ANTES de `/:id` — senão "meus" seria lido como um identificador */
router.get(
  '/meus',
  autenticar,
  validar.query(esquemas.listarMeus),
  autorizar('anuncio.ler'),
  controller.listarMeus
);

router.post(
  '/',
  rateLimit.escrita(),
  autenticar,
  validar(esquemas.criar),
  autorizar('anuncio.criar'),
  controller.criar
);

// ─── público (continua) ─────────────────────────────────────────
router.get(
  '/:id',
  rateLimit.leitura(),
  validar.params(esquemas.identificador),
  autenticacaoOpcional,
  controller.detalhar
);

router.get(
  '/:id/parecidos',
  rateLimit.leitura(),
  validar.params(esquemas.identificador),
  controller.parecidos
);

/* o clique no WhatsApp não exige login: o canal não depende de conta nenhuma
   (Maturacao/05, §8.2.2). O rate limit é o que impede inflar a métrica */
router.post(
  '/:id/contato',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.registrarContato),
  autenticacaoOpcional,
  controller.registrarContato
);

// ─── daqui para baixo, tudo exige conta ─────────────────────────
router.use(autenticar);

router.patch(
  '/:id',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.editar),
  autorizar('anuncio.editar'),
  controller.editar
);

router.delete(
  '/:id',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.remover),
  autorizar('anuncio.remover'),
  controller.remover
);

// ─── ciclo de vida ──────────────────────────────────────────────
router.post(
  '/:id/publicar',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.publicar),
  autorizar('anuncio.publicar'),
  controller.publicar
);

router.post(
  '/:id/pausar',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.pausar),
  autorizar('anuncio.pausar'),
  controller.pausar
);

router.post(
  '/:id/renovar',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.renovar),
  autorizar('anuncio.renovar'),
  controller.renovar
);

/* ocultar é moderação: a ação só existe com escopo `todos` no RBAC */
router.post(
  '/:id/ocultar',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.ocultar),
  autorizar('anuncio.ocultar'),
  controller.ocultar
);

// ─── fotos (o upload em si é do módulo `midia`) ─────────────────
router.post(
  '/:id/fotos',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.vincularFotos),
  autorizar('anuncio_foto.enviar'),
  controller.vincularFotos
);

router.patch(
  '/:id/fotos/ordem',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.reordenarFotos),
  autorizar('anuncio_foto.enviar'),
  controller.reordenarFotos
);

router.patch(
  '/:id/fotos/:fotoId/capa',
  rateLimit.escrita(),
  validar.params(esquemas.identificadorFoto),
  autorizar('anuncio_foto.enviar'),
  controller.definirCapa
);

router.delete(
  '/:id/fotos/:fotoId',
  rateLimit.escrita(),
  validar.params(esquemas.identificadorFoto),
  autorizar('anuncio_foto.remover'),
  controller.removerFoto
);

// ─── gestão ─────────────────────────────────────────────────────
router.get(
  '/:id/historico',
  validar.params(esquemas.identificador),
  autorizar('anuncio.ler'),
  controller.historico
);

router.get(
  '/:id/metricas',
  validar.params(esquemas.identificador),
  validar.query(esquemas.periodo),
  autorizar('anuncio.ver_metricas'),
  controller.metricas
);

router.get(
  '/:id/contatos',
  validar.params(esquemas.identificador),
  autorizar('anuncio.ver_contatos'),
  controller.contatos
);

module.exports = router;
