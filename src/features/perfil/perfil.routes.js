'use strict';

const { Router } = require('express');
const controller = require('./perfil.controller');
const esquemas = require('./perfil.validators');
const {
  autenticar,
  autenticacaoOpcional,
  autorizar,
  validar,
  rateLimit,
} = require('../../middlewares');

/**
 * Mapa da feature de perfil. Dá para ler o que existe, quem pode e o que é
 * validado sem abrir mais nada.
 *
 * Ordem dos middlewares: limite → validação → autenticação → autorização →
 * controller. Limitar antes de validar evita gastar CPU com requisição que
 * seria recusada de qualquer forma.
 *
 * As rotas fixas (`/meu`, `/meu/...`) vêm ANTES de `/:slug`. Express casa por
 * ordem de declaração, e invertido um perfil com slug "meu" sequestraria a
 * rota do próprio usuário. Ver `SLUGS_RESERVADOS` em `perfil.constants.js`.
 */

const router = Router();

// ─── público (sem login) ────────────────────────────────────────
/* `autenticacaoOpcional` e não `autenticar`: é a página que aparece no Google.
   Quem estiver logado é reconhecido — o dono e o Admin recebem a visão
   completa da mesma URL —, e o visitante segue vendo o público */
router.get(
  '/',
  rateLimit.leitura(),
  validar.query(esquemas.listagem),
  autenticacaoOpcional,
  controller.listarPublico
);

// ─── meu perfil (autenticado) ───────────────────────────────────
router.get('/meu', autenticar, autorizar('perfil.ler'), controller.verMeu);

router.patch(
  '/meu',
  rateLimit.escrita(),
  validar(esquemas.atualizar),
  autenticar,
  autorizar('perfil.editar'),
  controller.atualizarMeu
);

// horários de atendimento (loja e prestador)
router.get('/meu/horarios', autenticar, autorizar('perfil.ler'), controller.listarHorarios);

router.put(
  '/meu/horarios',
  rateLimit.escrita(),
  validar(esquemas.definirHorarios),
  autenticar,
  autorizar('perfil.editar'),
  controller.definirHorarios
);

router.delete(
  '/meu/horarios/:dia',
  rateLimit.escrita(),
  validar.params(esquemas.diaParam),
  autenticar,
  autorizar('perfil.editar'),
  controller.removerHorario
);

/* serviços, marcas e área de atendimento compartilham as mesmas rotas: a
   mecânica é idêntica e `:colecao` é um vocabulário fechado, validado contra
   `COLECOES` — não é caminho livre */
router.get(
  '/meu/:colecao',
  validar.params(esquemas.colecaoParam),
  autenticar,
  autorizar('perfil.ler'),
  controller.listarVinculos
);

router.put(
  '/meu/:colecao',
  rateLimit.escrita(),
  validar.params(esquemas.colecaoParam),
  validar(esquemas.definirColecao),
  autenticar,
  autorizar('perfil.editar'),
  controller.definirVinculos
);

router.post(
  '/meu/:colecao',
  rateLimit.escrita(),
  validar.params(esquemas.colecaoParam),
  validar(esquemas.vincular),
  autenticar,
  autorizar('perfil.editar'),
  controller.vincular
);

router.delete(
  '/meu/:colecao/:alvoId',
  rateLimit.escrita(),
  validar.params(esquemas.colecaoItemParam),
  autenticar,
  autorizar('perfil.editar'),
  controller.desvincular
);

// ─── perfil de terceiro (Admin e escopos `.todos`) ──────────────
router.patch(
  '/:id',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.atualizar),
  autenticar,
  autorizar('perfil.editar'),
  controller.atualizarPorId
);

router.delete(
  '/:id',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.remover),
  autenticar,
  autorizar('perfil.remover'),
  controller.removerPorId
);

/* `perfil.verificar` só existe com escopo `todos` (src/rbac/recursos.js):
   ninguém verifica o próprio cadastro, nem mandando `verificadoEm` no corpo —
   o campo não existe em nenhum esquema desta feature */
router.post(
  '/:id/verificacao',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.verificar),
  autenticar,
  autorizar('perfil.verificar'),
  controller.verificar
);

router.delete(
  '/:id/verificacao',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.remover),
  autenticar,
  autorizar('perfil.verificar'),
  controller.revogarVerificacao
);

// ─── página pública por slug — sempre por último ────────────────
router.get(
  '/:slug',
  rateLimit.leitura(),
  validar.params(esquemas.slugParam),
  autenticacaoOpcional,
  controller.ver
);

module.exports = router;
