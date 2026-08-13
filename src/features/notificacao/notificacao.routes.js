'use strict';

const { Router } = require('express');
const controller = require('./notificacao.controller');
const esquemas = require('./notificacao.validators');
const { autenticar, autorizar, somenteAdmin, validar, rateLimit } = require('../../middlewares');

/**
 * Rotas de notificação. O arquivo é o mapa da feature: dá para ler o que
 * existe, quem pode e o que é validado sem abrir mais nada.
 *
 * Ordem em toda rota: limite → autorização → validação → controller.
 *
 * **Nenhuma rota é pública.** Notificação é dado pessoal do titular; não há
 * variante "para visitante", nem sequer o contador.
 */

const router = Router();

router.use(autenticar);

// ─── caixa de entrada ───────────────────────────────────────────
router.get(
  '/',
  rateLimit.leitura(),
  autorizar('notificacao.ler'),
  validar.query(esquemas.listagem),
  controller.listar
);

/**
 * Contador do sininho. Limite próprio e generoso: é o endpoint mais chamado do
 * sistema (toda navegação), e o custo real dele é cache, não banco. Barrá-lo
 * no mesmo balde da listagem faria a tela piscar "muitas requisições" numa
 * navegação normal.
 */
router.get(
  '/nao-lidas',
  rateLimit({ max: 600, janelaMs: 60 * 1000 }),
  autorizar('notificacao.ler'),
  controller.contador
);

// ─── marcar como lida ───────────────────────────────────────────
router.patch(
  '/ler',
  rateLimit.escrita(),
  autorizar('notificacao.marcar_lida'),
  validar(esquemas.marcarVarias),
  controller.marcarVarias
);

router.patch(
  '/ler-todas',
  rateLimit.escrita(),
  autorizar('notificacao.marcar_lida'),
  validar(esquemas.marcarTodas),
  controller.marcarTodas
);

/* depois das rotas literais: `/nao-lidas` e `/ler` não podem cair no `:id` */
router.patch(
  '/:id/ler',
  rateLimit.escrita(),
  autorizar('notificacao.marcar_lida'),
  validar.params(esquemas.identificador),
  controller.marcarUma
);

// ─── preferências ───────────────────────────────────────────────
router.get('/preferencias', autorizar('notificacao.preferencias'), controller.listarPreferencias);

router.put(
  '/preferencias',
  rateLimit.escrita(),
  autorizar('notificacao.preferencias'),
  validar(esquemas.preferencias),
  controller.salvarPreferencias
);

// ─── templates (Admin) ──────────────────────────────────────────
/**
 * `somenteAdmin` SOMADO à capacidade, e não no lugar dela.
 *
 * `notificacao.template_editar` foi declarada sem escopo em
 * `src/rbac/recursos.js`, e `propriasDoRecurso('notificacao')` (em
 * `src/rbac/papeis.js`) entrega toda permissão sem escopo ao papel `usuario` —
 * ou seja, hoje qualquer cadastro carrega essa chave. Editar o texto que sai
 * para a base inteira em nome da plataforma não pode depender de um detalhe do
 * catálogo estar certo, então a rota exige as duas coisas. O conserto de
 * verdade é no RBAC e está no relatório do módulo.
 */
router.get(
  '/templates',
  autorizar('notificacao.template_editar'),
  somenteAdmin,
  controller.listarTemplates
);

router.post(
  '/templates',
  rateLimit.escrita(),
  autorizar('notificacao.template_editar'),
  somenteAdmin,
  validar(esquemas.criarTemplate),
  controller.criarTemplate
);

router.get(
  '/templates/:id',
  autorizar('notificacao.template_editar'),
  somenteAdmin,
  validar.params(esquemas.identificador),
  controller.obterTemplate
);

router.put(
  '/templates/:id',
  rateLimit.escrita(),
  autorizar('notificacao.template_editar'),
  somenteAdmin,
  validar.params(esquemas.identificador),
  validar(esquemas.atualizarTemplate),
  controller.atualizarTemplate
);

router.delete(
  '/templates/:id',
  rateLimit.escrita(),
  autorizar('notificacao.template_editar'),
  somenteAdmin,
  validar.params(esquemas.identificador),
  controller.removerTemplate
);

// ─── comunicado em massa (Admin) ────────────────────────────────
/* limite apertado de propósito: falar com a base inteira é ação rara, e um
   script disparando comunicados em série é incidente, não uso legítimo */
router.post(
  '/massa',
  rateLimit({ max: 5, janelaMs: 60 * 60 * 1000 }),
  autorizar('notificacao.enviar'),
  validar(esquemas.enviarEmMassa),
  controller.enviarEmMassa
);

/* histórico dos disparos — o painel de comunicados precisa mostrar o que já
   foi mandado, não só o botão de mandar de novo */
router.get(
  '/massa',
  rateLimit.leitura(),
  autorizar('notificacao.enviar'),
  validar.query(esquemas.listarEmMassa),
  controller.listarEmMassa
);

module.exports = router;
