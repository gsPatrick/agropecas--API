'use strict';

const { Router } = require('express');
const controller = require('./usuario.controller');
const esquemas = require('./usuario.validators');
const { autenticar, autorizar, validar, rateLimit } = require('../../middlewares');

/**
 * Rotas da conta. O arquivo é o mapa da feature: dá para ler o que existe,
 * quem pode e o que é validado sem abrir mais nada.
 *
 * Ordem em toda rota: limite → autorização (capacidade) → validação →
 * controller. O **escopo** (`.proprio` × `.todos`) não aparece aqui de
 * propósito: ele depende do dono do registro, que só é conhecido depois da
 * consulta — por isso mora no service. Middleware que fingisse checar escopo
 * daria falsa sensação de proteção.
 *
 * Tudo aqui é autenticado. Não existe leitura pública de cadastro: página
 * pública de vendedor é assunto do módulo de perfil, que expõe outro recorte
 * de dados.
 */

const router = Router();

router.use(autenticar);

// ─── a minha conta ──────────────────────────────────────────────
router.get('/eu', controller.eu);
router.patch('/eu', rateLimit.escrita(), validar(esquemas.atualizar), controller.atualizarEu);

/* troca de e-mail em dois passos: pedir (código vai para o endereço novo) e
   confirmar. Limite de código, não de escrita — o custo é o envio */
router.post(
  '/eu/email',
  rateLimit.codigo(),
  validar(esquemas.trocarEmail),
  controller.solicitarTrocaEmail
);
router.post(
  '/eu/email/confirmar',
  rateLimit.autenticacao(),
  validar(esquemas.confirmarEmail),
  controller.confirmarTrocaEmail
);

router.delete('/eu', rateLimit.escrita(), validar(esquemas.excluirConta), controller.excluirEu);

// ─── moderação e suporte ────────────────────────────────────────
router.get(
  '/',
  rateLimit.leitura(),
  autorizar('usuario.ler'),
  validar.query(esquemas.listagem),
  controller.listar
);

router.get(
  '/:id',
  rateLimit.leitura(),
  autorizar('usuario.ler'),
  validar.params(esquemas.identificador),
  controller.ver
);

router.patch(
  '/:id',
  rateLimit.escrita(),
  autorizar('usuario.editar'),
  validar.params(esquemas.identificador),
  validar(esquemas.atualizar),
  controller.atualizar
);

router.delete(
  '/:id',
  rateLimit.escrita(),
  autorizar('usuario.remover'),
  validar.params(esquemas.identificador),
  controller.excluir
);

router.post(
  '/:id/suspender',
  rateLimit.escrita(),
  autorizar('usuario.suspender'),
  validar.params(esquemas.identificador),
  validar(esquemas.suspender),
  controller.suspender
);

router.post(
  '/:id/banir',
  rateLimit.escrita(),
  autorizar('usuario.banir'),
  validar.params(esquemas.identificador),
  validar(esquemas.banir),
  controller.banir
);

router.post(
  '/:id/restaurar',
  rateLimit.escrita(),
  autorizar('usuario.restaurar'),
  validar.params(esquemas.identificador),
  validar(esquemas.restaurar),
  controller.restaurar
);

// ─── papéis (RBAC) ──────────────────────────────────────────────
router.get(
  '/:id/papeis',
  rateLimit.leitura(),
  autorizar('usuario.ler'),
  validar.params(esquemas.identificador),
  controller.listarPapeis
);

router.post(
  '/:id/papeis',
  rateLimit.escrita(),
  autorizar('rbac.atribuir_papel'),
  validar.params(esquemas.identificador),
  validar(esquemas.atribuirPapel),
  controller.atribuirPapel
);

router.delete(
  '/:id/papeis/:papel',
  rateLimit.escrita(),
  autorizar('rbac.atribuir_papel'),
  validar.params(esquemas.identificadorPapel),
  controller.removerPapel
);

module.exports = router;
