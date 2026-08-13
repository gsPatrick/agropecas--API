'use strict';

const catchAsync = require('../../../utils/catch-async');
const resposta = require('../../../utils/resposta');
const lgpdService = require('../services/admin.conformidade.lgpd.service');
const auditoriaService = require('../services/admin.conformidade.auditoria.service');

/**
 * Conformidade: LGPD, trilha de auditoria e relatórios.
 *
 * Repare no que NÃO existe: nenhum `atualizar` e nenhum `remover` de linha de
 * trilha. A ausência é a funcionalidade — `PATCH /auditoria/:id` responde 404
 * porque a rota nunca foi declarada, e é assim que continua sendo verdade que
 * ninguém edita a própria trilha, nem o Admin.
 */

/**
 * Query como o cliente MANDOU, antes da validação.
 *
 * `validar.query` substitui `req.query` pelo objeto limpo e descarta campo
 * desconhecido em silêncio — que é exatamente onde um `?excluirAtor=<eu>`
 * passaria despercebido, e o auditado sumiria da própria trilha achando que o
 * filtro não existe.
 *
 * Quem guarda o original é o middleware `queryBruta`, instalado nas rotas de
 * trilha em `admin.routes.js`. Antes isto reconstruía a query a partir de
 * `req.originalUrl`, o que funcionava mas dependia de um detalhe do Express e
 * duplicava, em texto, uma decisão que já era do roteador.
 */
const queryCrua = (req) => req.queryBruta || req.originalQuery || {};

/* ─── LGPD ─────────────────────────────────────────────────── */

const listarSolicitacoes = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total, resumo } = await lgpdService.listarSolicitacoes(
    req.contexto,
    req.query
  );

  res.status(200).json({
    sucesso: true,
    dados: itens,
    meta: {
      pagina,
      porPagina,
      total,
      totalPaginas: Math.max(1, Math.ceil(total / porPagina)),
      /* o prazo legal e o que está vencendo viajam junto com a lista: são a
         razão de a tela existir, não um detalhe de rodapé */
      resumo,
    },
  });
});

const verSolicitacao = catchAsync(async (req, res) => {
  resposta.ok(res, await lgpdService.verSolicitacao(req.contexto, req.params.id));
});

const responderSolicitacao = catchAsync(async (req, res) => {
  const dados = await lgpdService.responderSolicitacao(req.contexto, req.params.id, req.body);
  resposta.ok(res, dados, { mensagem: 'Solicitação respondida.' });
});

const listarDocumentos = catchAsync(async (req, res) => {
  const { vigentes, versoes, reaceitePendente, totalReaceitePendente } =
    await lgpdService.listarDocumentos();

  resposta.ok(res, { vigentes, versoes }, { reaceitePendente, totalReaceitePendente });
});

const publicarDocumento = catchAsync(async (req, res) => {
  const { documento, reaceitePendente } = await lgpdService.publicarDocumento(req.contexto, req.body);
  resposta.criado(res, documento, { reaceitePendente });
});

/* ─── AUDITORIA ────────────────────────────────────────────── */

const trilha = catchAsync(async (req, res) => {
  const { itens, periodo, ...meta } = await auditoriaService.trilha(
    req.contexto,
    req.query,
    queryCrua(req)
  );

  res.status(200).json({
    sucesso: true,
    dados: itens,
    meta: { ...meta, totalPaginas: Math.max(1, Math.ceil(meta.total / meta.porPagina)), periodo },
  });
});

const acessosADados = catchAsync(async (req, res) => {
  const { itens, ...meta } = await auditoriaService.acessosADados(req.contexto, req.query, queryCrua(req));
  resposta.paginado(res, itens, meta);
});

/* 202: quem trabalha é a fila, e o cliente recebe protocolo, não arquivo */
const exportarTrilha = catchAsync(async (req, res) => {
  resposta.aceito(res, await auditoriaService.exportarTrilha(req.contexto, req.body, req.body));
});

/* ─── RELATÓRIOS ───────────────────────────────────────────── */

const relatorios = catchAsync(async (req, res) => {
  resposta.ok(res, await auditoriaService.relatorios(req.contexto, req.query));
});

const exportarRelatorio = catchAsync(async (req, res) => {
  resposta.aceito(res, await auditoriaService.exportarRelatorio(req.contexto, req.body));
});

module.exports = {
  listarSolicitacoes,
  verSolicitacao,
  responderSolicitacao,
  listarDocumentos,
  publicarDocumento,
  trilha,
  acessosADados,
  exportarTrilha,
  relatorios,
  exportarRelatorio,
};
