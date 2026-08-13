'use strict';

const painelService = require('../services/admin.painel.service');
const metricasService = require('../services/admin.painel.metricas.service');
const auditoriaMapper = require('../../auditoria/auditoria.mapper');
const catchAsync = require('../../../utils/catch-async');
const resposta = require('../../../utils/resposta');

/**
 * Controller do painel — HTTP e só isso.
 *
 * Nenhum `if` de permissão mora aqui. O que decide quais cards o solicitante
 * recebe é `admin.shared.capacidades`, dentro do service, onde o contexto do
 * RBAC está disponível e onde a decisão vira consulta (ou a ausência dela).
 * Filtrar a resposta no controller deixaria o servidor calculando dados que
 * o chamador não pode ver — e dado calculado é dado que um bug futuro devolve.
 */

const resumo = catchAsync(async (req, res) => {
  resposta.ok(res, await painelService.resumo(req.contexto));
});

const pendencias = catchAsync(async (req, res) => {
  const { itens, total, calculadoEm } = await painelService.pendencias(req.contexto);
  resposta.ok(res, itens, { total, calculadoEm });
});

const metricas = catchAsync(async (req, res) => {
  resposta.ok(res, await metricasService.metricas(req.contexto, req.query));
});

/**
 * Últimas ações administrativas.
 *
 * Lê `logs_auditoria` — a trilha é só leitura, inclusive para o Admin (ver
 * `auditoria.consulta.service`). O mapper da própria feature é reaproveitado
 * para que a decisão de não expor `ip_hash` continue valendo aqui.
 */
const atividade = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await painelService.atividadeAdministrativa(
    req.contexto,
    req.query
  );

  resposta.paginado(res, itens.map(auditoriaMapper.linha), { pagina, porPagina, total });
});

const saude = catchAsync(async (req, res) => {
  resposta.ok(res, await metricasService.saude(req.contexto));
});

module.exports = { resumo, pendencias, metricas, atividade, saude };
