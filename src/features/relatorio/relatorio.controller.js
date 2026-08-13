'use strict';

const path = require('path');
const painelService = require('./relatorio.painel.service');
const publicoService = require('./relatorio.publico.service');
const desempenhoService = require('./relatorio.desempenho.service');
const buscaService = require('./relatorio.busca.service');
const exportacaoService = require('./relatorio.exportacao.service');
const mapper = require('./relatorio.mapper');
const config = require('../../config');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');
const { lerPeriodo } = require('./relatorio.comum');
const { PERIODO_MAX_DIAS_EXPORTACAO } = require('./relatorio.constants');

/**
 * Camada HTTP dos relatórios.
 *
 * A leitura do período é feita aqui e passada pronta ao service — assim o
 * mesmo service atende a requisição e o job da fila, que monta o período por
 * conta própria e não tem `req`.
 */

/**
 * Números da home. Sem período, sem filtro, sem contexto.
 *
 * Não lê NADA de `req` de propósito. Qualquer parâmetro aceito aqui viraria
 * um recorte, e recorte numa rota sem login é o começo de um vazamento — a
 * decisão está registrada em `relatorio.publico.service.js`.
 */
const publico = catchAsync(async (req, res) => {
  resposta.ok(res, await publicoService.publico());
});

const painel = catchAsync(async (req, res) => {
  const periodo = lerPeriodo(req.query);
  resposta.ok(res, await painelService.painel(periodo, { top: req.query.top }));
});

const desempenho = catchAsync(async (req, res) => {
  const periodo = lerPeriodo(req.query);

  resposta.ok(
    res,
    await desempenhoService.desempenho(req.contexto, periodo, {
      /* o id do dono NÃO é assumido da query: o service confere o escopo e
         devolve 403 se quem pediu não pode ver o número de terceiro */
      usuarioId: req.query.usuarioId,
      top: req.query.top,
    })
  );
});

const busca = catchAsync(async (req, res) => {
  const periodo = lerPeriodo(req.query);
  resposta.ok(res, await buscaService.busca(periodo, { top: req.query.top, uf: req.query.uf }));
});

const exportar = catchAsync(async (req, res) => {
  /* teto maior para exportação: ela roda na fila e não segura conexão de
     banco no caminho da resposta */
  const periodo = lerPeriodo(req.body, { maxDias: PERIODO_MAX_DIAS_EXPORTACAO });

  /* o escopo do pedido é decidido AGORA, com o contexto de quem pede, e vai
     congelado para o job — o worker não tem sessão para reavaliar permissão */
  const escopoUsuarioId =
    req.body.relatorio === 'desempenho'
      ? desempenhoService.podeVerDeTerceiro(req.contexto)
        ? req.body.usuarioId || req.contexto.usuarioId
        : req.contexto.usuarioId
      : null;

  const pedido = await exportacaoService.solicitar(req.contexto, {
    relatorio: req.body.relatorio,
    formato: req.body.formato,
    de: periodo.diaDe,
    ate: periodo.diaAte,
    escopoUsuarioId,
    filtros: { top: req.body.top, uf: req.body.uf },
  });

  /* 202 e não 200: o recurso ainda não existe, foi só aceito para produção */
  resposta.aceito(res, pedido);
});

const listarExportacoes = catchAsync(async (req, res) => {
  const itens = await exportacaoService.listar(req.contexto.usuarioId);
  resposta.ok(res, itens.map(mapper.exportacao));
});

const baixarExportacao = catchAsync(async (req, res) => {
  const arquivo = await exportacaoService.paraDownload(req.params.id, req.contexto.usuarioId, req.query.t);

  res.setHeader('Content-Type', arquivo.mime || 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${arquivo.nome_original}"`);
  /* relatório é dado de negócio: nenhum proxy ou CDN pode guardar cópia */
  res.setHeader('Cache-Control', 'no-store, private');

  res.sendFile(path.resolve(config.storage.localPath, arquivo.path));
});

module.exports = { publico, painel, desempenho, busca, exportar, listarExportacoes, baixarExportacao };
