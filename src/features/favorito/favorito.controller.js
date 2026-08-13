'use strict';

const gerenciarService = require('./favorito.gerenciar.service');
const consultaService = require('./favorito.consulta.service');
const mapper = require('./favorito.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

/**
 * Controller — só HTTP. Nenhuma regra aqui: o que é idempotente, quem pode
 * ler a lista de quem e como o contador é mantido são decisões dos services,
 * que precisam funcionar igual quando chamados de um job.
 */

/**
 * 201 quando nasceu, 200 quando já existia.
 *
 * A diferença é informativa, não de erro: o front trata as duas como sucesso e
 * pinta o coração. Quem quiser distinguir (para animar só na primeira vez) lê
 * `dados.criado`.
 */
const salvar = catchAsync(async (req, res) => {
  const { favorito, criado } = await gerenciarService.salvar(req.contexto, req.body);
  const corpo = { ...mapper.item(favorito), criado };

  if (criado) return resposta.criado(res, corpo, { mensagem: 'Anúncio salvo nos seus favoritos.' });
  return resposta.ok(res, corpo, { mensagem: 'Este anúncio já estava salvo.' });
});

const remover = catchAsync(async (req, res) => {
  await gerenciarService.remover(req.contexto, { anuncioId: req.params.anuncioId });
  resposta.semConteudo(res);
});

const listar = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await consultaService.listar(req.contexto, req.query);
  resposta.paginado(res, mapper.lista(itens), { pagina, porPagina, total });
});

const listarDeUsuario = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await consultaService.listar(req.contexto, {
    ...req.query,
    usuarioId: req.params.usuarioId,
  });
  resposta.paginado(res, mapper.lista(itens), { pagina, porPagina, total });
});

const marcados = catchAsync(async (req, res) => {
  resposta.ok(res, await consultaService.marcados(req.contexto, req.body.anuncioIds));
});

const contador = catchAsync(async (req, res) => {
  resposta.ok(res, await consultaService.contador(req.contexto, req.params.anuncioId));
});

module.exports = { salvar, remover, listar, listarDeUsuario, marcados, contador };
