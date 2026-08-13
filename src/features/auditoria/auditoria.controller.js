'use strict';

const consulta = require('./auditoria.consulta.service');
const exportacao = require('./auditoria.exportacao.service');
const servico = require('./auditoria.service');
const mapper = require('./auditoria.mapper');
const { RECURSO_ACESSO } = require('./auditoria.constants');
const linkService = require('../lgpd/lgpd.link.service');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

/**
 * Camada HTTP da trilha.
 *
 * Repare no que NÃO existe aqui: nenhum `atualizar`, nenhum `remover`. A
 * ausência é a funcionalidade — trilha editável não é trilha. O expurgo por
 * prazo de retenção é do job de LGPD, que apaga por data e nunca por alvo.
 *
 * `req.query` chega validado (o middleware substitui a fonte pelo dado limpo),
 * mas os handlers repassam também `req.originalUrl`-derived cru quando o
 * service precisa enxergar o que o cliente TENTOU mandar — o validador
 * descarta campo desconhecido em silêncio, e um filtro de exclusão precisa ser
 * recusado com barulho.
 */

const listar = catchAsync(async (req, res) => {
  const bruto = { ...req.originalQuery };
  const { itens, periodo, ...meta } = await consulta.listar(req.contexto, req.query, bruto);

  /* consultar a trilha é ler ação de terceiros: fica registrado, e o registro
     não pode ser apagado nem pelo próprio Admin */
  await servico.registrarAcessoDado(req.contexto, {
    titularId: req.query.atorId || null,
    recurso: RECURSO_ACESSO.TRILHA_AUDITORIA,
    motivo: 'consulta à trilha de auditoria',
  });

  res.status(200).json({
    sucesso: true,
    dados: itens.map(mapper.linha),
    meta: {
      ...meta,
      totalPaginas: Math.max(1, Math.ceil(meta.total / meta.porPagina)),
      periodo,
    },
  });
});

const obter = catchAsync(async (req, res) => {
  const registro = await consulta.obter(req.contexto, req.params.id);
  resposta.ok(res, mapper.detalhe(registro));
});

const daEntidade = catchAsync(async (req, res) => {
  const { itens, ...meta } = await consulta.daEntidade(
    req.contexto,
    { entidade: req.params.entidade, entidadeId: req.params.entidadeId },
    req.query
  );

  await servico.registrarAcessoDado(req.contexto, {
    titularId: req.params.entidade === 'usuario' ? req.params.entidadeId : null,
    recurso: RECURSO_ACESSO.TRILHA_AUDITORIA,
    recursoId: req.params.entidadeId,
    motivo: `histórico de ${req.params.entidade}`,
  });

  resposta.paginado(res, itens.map(mapper.detalhe), meta);
});

const acessos = catchAsync(async (req, res) => {
  /* o segundo argumento é a query CRUA, e precisa vir de `req.queryBruta`:
     passar `req.query` duas vezes entregava ao verificador o objeto que a
     validação já havia limpado, então `?excluirAtor=<eu>` chegava vazio e a
     recusa nunca disparava. A rota instala `queryBruta` para isto */
  const { itens, ...meta } = await consulta.acessosAoTitular(
    req.contexto,
    req.query,
    req.queryBruta || req.originalQuery || {}
  );
  resposta.paginado(res, itens.map(mapper.acessoDado), meta);
});

const exportar = catchAsync(async (req, res) => {
  const dados = await exportacao.solicitar(req.contexto, req.body, req.body);
  resposta.aceito(res, dados);
});

const baixar = catchAsync(async (req, res) => {
  const { conteudo, nomeArquivo, mime } = await linkService.resgatar(req.params.token, req.contexto);

  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  res.setHeader('Cache-Control', 'no-store, private');
  res.send(conteudo);
});

module.exports = { listar, obter, daEntidade, acessos, exportar, baixar };
