'use strict';

const { Router } = require('express');
const controller = require('./auth.controller');
const esquemas = require('./auth.validators');
const {
  autenticar,
  validar,
  rateLimit,
} = require('../../middlewares');

/**
 * Rotas de autenticação. O arquivo é o mapa da feature: dá para ler o que
 * existe, quem pode e o que é validado sem abrir mais nada.
 *
 * Ordem dos middlewares: limite → autenticação → autorização → validação →
 * controller.
 *
 * Limitar primeiro evita gastar CPU com requisição que já seria recusada. E
 * autorizar antes de validar evita devolver, a quem não tem permissão, um mapa
 * do esquema de entrada — quais campos existem e quais são obrigatórios.
 */

const router = Router();

// ─── público ────────────────────────────────────────────────────
router.post('/registrar', rateLimit.autenticacao(), validar(esquemas.registro), controller.registrar);
router.post('/entrar', rateLimit.autenticacao(), validar(esquemas.login), controller.entrar);
router.post(
  '/renovar',
  rateLimit({ max: 60, janelaMs: 60 * 1000 }),
  validar(esquemas.renovar),
  controller.renovar
);

// ─── recuperação de senha (3 passos) ────────────────────────────
router.post('/senha/solicitar', rateLimit.codigo(), validar(esquemas.solicitarSenha), controller.solicitarSenha);
router.post('/senha/conferir', rateLimit.autenticacao(), validar(esquemas.conferirCodigo), controller.conferirCodigoSenha);
router.post('/senha/redefinir', rateLimit.autenticacao(), validar(esquemas.redefinirSenha), controller.redefinirSenha);

// ─── confirmação de e-mail ──────────────────────────────────────
router.post('/email/confirmar', rateLimit.autenticacao(), validar(esquemas.confirmarEmail), controller.confirmarEmail);
router.post('/email/reenviar', rateLimit.codigo(), validar(esquemas.reenviarCodigo), controller.reenviarCodigo);

// ─── autenticado ────────────────────────────────────────────────
router.use(autenticar);

router.get('/eu', controller.eu);
router.post('/sair', controller.sair);
router.post('/sair-de-todos', validar(esquemas.sairDeTodos), controller.sairDeTodos);
router.patch('/senha', rateLimit.escrita(), validar(esquemas.trocarSenha), controller.trocarSenha);

router.get('/sessoes', controller.listarSessoes);
router.delete('/sessoes/:id', validar.params(esquemas.identificador), controller.encerrarSessao);

router.get('/consentimentos', controller.listarConsentimentos);
router.patch(
  '/consentimentos',
  rateLimit.escrita(),
  validar(esquemas.atualizarConsentimento),
  controller.atualizarConsentimento
);

module.exports = router;
