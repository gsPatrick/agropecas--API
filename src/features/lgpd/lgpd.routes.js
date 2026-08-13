'use strict';

const { Router } = require('express');
const controller = require('./lgpd.controller');
const esquemas = require('./lgpd.validators');
const { autenticar, autorizar, validar, rateLimit } = require('../../middlewares');

/**
 * Mapa da feature de conformidade. Dá para ler o que existe, quem pode e o que
 * é validado sem abrir mais nada.
 *
 * Ordem em toda rota: limite → validação → autorização → controller.
 *
 * Os documentos legais ficam ANTES do `autenticar`: uma pessoa precisa
 * conseguir ler os Termos e a Política **antes** de ter conta. Exigir login
 * para ler a política de privacidade seria exigir consentimento para saber a
 * que se está consentindo.
 */

const router = Router();

// ─── público ────────────────────────────────────────────────────
router.get('/documentos', rateLimit.leitura(), controller.documentosVigentes);
router.get(
  '/documentos/:tipo',
  rateLimit.leitura(),
  validar.params(esquemas.tipoDocumento),
  controller.documentoVigente
);

// ─── autenticado ────────────────────────────────────────────────
router.use(autenticar);

/* consentimentos — visão do titular sobre o que ele já aceitou */
router.get('/consentimentos', controller.meusConsentimentos);
router.get('/consentimentos/pendencias', controller.pendencias);

/* solicitações do titular (art. 18) */
router.post(
  '/solicitacoes',
  rateLimit.escrita(),
  validar(esquemas.abrirSolicitacao),
  autorizar('lgpd.solicitar'),
  controller.abrir
);
router.get('/solicitacoes/minhas', validar.query(esquemas.listarMinhas), controller.minhas);

/**
 * Exportação de dados.
 *
 * Limite bem mais apertado que `rateLimit.escrita()`: cada confirmação enfileira
 * a leitura de sete tabelas inteiras de uma conta. Cinco por hora atende
 * qualquer uso legítimo — ninguém exporta a própria vida seis vezes numa tarde
 * — e tira o endpoint da lista de alvos baratos para derrubar o worker.
 */
const limiteExportacao = rateLimit({
  max: 5,
  janelaMs: 60 * 60 * 1000,
  /* por CONTA e não por IP: no interior de MT a região inteira sai pelo mesmo
     IP de operadora, e contar por IP faria um usuário gastar a cota do vizinho */
  chave: (req) => `lgpd-export:${req.contexto?.usuarioId || req.ip}`,
});

router.post(
  '/exportacoes',
  limiteExportacao,
  validar(esquemas.reautenticar),
  autorizar('usuario.exportar_dados'),
  controller.solicitarExportacao
);
router.post(
  '/exportacoes/confirmar',
  limiteExportacao,
  validar(esquemas.confirmarCodigo),
  autorizar('usuario.exportar_dados'),
  controller.confirmarExportacao
);
router.post(
  '/exportacoes/titular',
  limiteExportacao,
  validar(esquemas.exportarParaTitular),
  autorizar('usuario.exportar_dados'),
  controller.exportarParaTitular
);

/* download do pacote: o bilhete é de uso único e o dono é conferido no service */
router.get(
  '/downloads/:token',
  rateLimit({ max: 20, janelaMs: 60 * 60 * 1000, chave: (req) => `lgpd-download:${req.contexto?.usuarioId || req.ip}` }),
  validar.params(esquemas.tokenDownload),
  controller.baixar
);

/**
 * Anonimização — irreversível, por isso confirmação textual e reautenticação.
 *
 * Cinco por hora e não três: o limite conta também as tentativas recusadas
 * (ele roda antes da validação, de propósito, para não gastar CPU com pedido
 * que já seria negado), e quem erra a frase de confirmação duas vezes ainda
 * precisa conseguir concluir o que veio fazer.
 */
router.post(
  '/anonimizacao',
  rateLimit({ max: 5, janelaMs: 60 * 60 * 1000, chave: (req) => `lgpd-anon:${req.contexto?.usuarioId || req.ip}` }),
  validar(esquemas.anonimizar),
  controller.anonimizar
);

// ─── encarregado (DPO) e Admin ──────────────────────────────────
router.get(
  '/solicitacoes',
  autorizar('lgpd.ler_solicitacoes'),
  validar.query(esquemas.listarSolicitacoes),
  controller.listar
);
router.get('/solicitacoes/resumo', autorizar('lgpd.ler_solicitacoes'), controller.resumo);
router.get(
  '/solicitacoes/:id',
  validar.params(esquemas.identificador),
  controller.obter
);
router.patch(
  '/solicitacoes/:id',
  rateLimit.escrita(),
  validar.params(esquemas.identificador),
  validar(esquemas.responder),
  autorizar('lgpd.responder_solicitacao'),
  controller.responder
);

router.get(
  '/documentos-historico',
  autorizar('lgpd.publicar_documento'),
  validar.query(esquemas.filtroDocumento),
  controller.historicoDocumentos
);
router.post(
  '/documentos',
  rateLimit.escrita(),
  validar(esquemas.publicarDocumento),
  autorizar('lgpd.publicar_documento'),
  controller.publicarDocumento
);

router.get(
  '/panorama-consentimentos',
  autorizar('lgpd.ler_solicitacoes'),
  controller.panoramaConsentimentos
);

module.exports = router;
