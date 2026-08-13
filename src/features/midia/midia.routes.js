'use strict';

const { Router } = require('express');
const controller = require('./midia.controller');
const esquemas = require('./midia.validators');
const receber = require('./midia.recepcao.middleware');
const { autenticar, autorizar, validar, rateLimit } = require('../../middlewares');

/**
 * Rotas de mídia. O arquivo é o mapa da feature: o que existe, quem pode e o
 * que é validado, sem abrir mais nada.
 *
 * Ordem no upload: autenticação → limite → parser do multipart → validação
 * dos campos de texto → controller. O limite vem ANTES do parser de propósito
 * — recusar depois de ler 80MB do socket é gastar banda e memória com uma
 * requisição que já estava condenada.
 */

const router = Router();

router.use(autenticar);

/**
 * Limite próprio, por conta e não por IP.
 *
 * No interior de MT a loja inteira sai pelo mesmo IP da operadora; contar por
 * IP faria o segundo vendedor da mesma revenda ser barrado pelo trabalho do
 * primeiro. O número é generoso o bastante para um anúncio de dez fotos
 * seguido de correção, e baixo o bastante para que ninguém use o storage da
 * plataforma como hospedagem de imagem.
 */
const limiteDeUpload = rateLimit({
  max: 30,
  janelaMs: 10 * 60 * 1000,
  chave: (req) => req.contexto?.usuarioId || req.contexto?.ipHash,
  mensagem: 'Muitos envios em pouco tempo. Aguarde alguns minutos.',
});

router.post(
  '/',
  autorizar('arquivo.enviar'),
  limiteDeUpload,
  receber,
  validar(esquemas.upload),
  controller.enviar
);

router.get('/', rateLimit.leitura(), validar.query(esquemas.listagem), controller.listar);
router.get('/:id', rateLimit.leitura(), validar.params(esquemas.identificador), controller.obter);

router.delete(
  '/:id',
  autorizar('arquivo.remover'),
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  controller.remover
);

module.exports = router;
