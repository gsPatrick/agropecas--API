'use strict';

const { Router } = require('express');
const controller = require('./conversa.controller');
const esquemas = require('./conversa.validators');
const { autenticar, autorizar, validar, rateLimit } = require('../../middlewares');
const { LIMITE_ENVIO, LIMITE_INICIO } = require('./conversa.constants');

/**
 * Rotas do chat. O arquivo é o mapa da feature: dá para ver o que existe, quem
 * pode e o que é validado sem abrir mais nada.
 *
 * Ordem em toda rota: limite → autorização → validação → controller.
 *
 * **Nada aqui é público.** `router.use(autenticar)` na primeira linha, e não
 * rota a rota: a cliente foi explícita em Maturacao/05, §8 — quem não está
 * logado não conversa. O front já esconde o botão; quem garante é esta linha.
 */

const router = Router();

router.use(autenticar);

/* o limite de envio conta por CONTA, não por IP: uma cidade inteira atrás do
   mesmo IP de operadora não pode compartilhar a cota de spam de um usuário */
const porUsuario = (opcoes) =>
  rateLimit({
    ...opcoes,
    chave: (req) => req.contexto.usuarioId || req.contexto.ipHash,
    mensagem: 'Você está enviando mensagens rápido demais. Aguarde um instante.',
  });

// ─── bloqueios ──────────────────────────────────────────────────
/* antes de `/:id`: `/bloqueios` cairia na rota de detalhe e morreria na
   validação de uuid */
router.get('/bloqueios', autorizar('bloqueio.gerenciar'), controller.listarBloqueios);
router.post(
  '/bloqueios',
  rateLimit.escrita(),
  autorizar('bloqueio.gerenciar'),
  validar(esquemas.bloquear),
  controller.bloquear
);
router.delete(
  '/bloqueios/:usuarioId',
  rateLimit.escrita(),
  autorizar('bloqueio.gerenciar'),
  validar.params(esquemas.identificadorUsuario),
  controller.desbloquear
);

// ─── mensagem avulsa (remoção) ──────────────────────────────────
router.delete(
  '/mensagens/:id',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.remover),
  controller.removerMensagem
);

// ─── caixa de entrada ───────────────────────────────────────────
router.get('/', autorizar('conversa.ler'), validar.query(esquemas.listar), controller.listar);
router.get('/nao-lidas', autorizar('conversa.ler'), controller.naoLidas);

router.post(
  '/',
  porUsuario(LIMITE_INICIO),
  autorizar('conversa.criar'),
  validar(esquemas.iniciar),
  controller.iniciar
);

// ─── uma conversa ───────────────────────────────────────────────
router.get('/:id', validar.params(esquemas.identificador), controller.detalhar);

router.get(
  '/:id/mensagens',
  rateLimit.leitura(),
  validar.params(esquemas.identificador),
  validar.query(esquemas.mensagens),
  controller.mensagens
);

router.post(
  '/:id/mensagens',
  porUsuario(LIMITE_ENVIO),
  validar.params(esquemas.identificador),
  validar(esquemas.enviar),
  controller.enviar
);

router.post('/:id/ler', validar.params(esquemas.identificador), controller.marcarLida);

router.post(
  '/:id/arquivar',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  controller.arquivar
);
router.delete(
  '/:id/arquivar',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  controller.desarquivar
);

router.post(
  '/:id/encerrar',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.encerrar),
  controller.encerrar
);

module.exports = router;
