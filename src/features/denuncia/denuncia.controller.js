'use strict';

const criacaoService = require('./denuncia.criacao.service');
const consultaService = require('./denuncia.consulta.service');
const resolucaoService = require('./denuncia.resolucao.service');
const mapper = require('./denuncia.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

/**
 * Controller — só HTTP.
 *
 * A única decisão que mora aqui é de CÓDIGO DE RESPOSTA: denúncia repetida
 * volta 200 em vez de 201. É informação sobre a requisição, não regra de
 * negócio — o service já resolveu que nada foi criado.
 */

const criar = catchAsync(async (req, res) => {
  const { denuncia, jaExistia } = await criacaoService.criar(req.contexto, req.body);

  const corpo = mapper.minha(denuncia);
  const aviso = { mensagem: 'Recebemos sua denúncia. Nossa equipe vai analisar.' };

  /* 200 e não 409: para quem denunciou, clicar duas vezes deu no mesmo — e um
     erro aqui só ensinaria o front a tratar duplicidade que não é problema */
  return jaExistia
    ? resposta.ok(res, corpo, { ...aviso, jaRegistrada: true })
    : resposta.criado(res, corpo, aviso);
});

const listar = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await consultaService.listar(req.contexto, req.query);
  resposta.paginado(res, mapper.lista(itens), { pagina, porPagina, total });
});

const agrupadas = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await consultaService.agrupadasPorAlvo(
    req.contexto,
    req.query
  );
  resposta.paginado(res, itens.map(mapper.grupo), { pagina, porPagina, total });
});

const minhas = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await consultaService.minhas(req.contexto, req.query);
  resposta.paginado(res, itens.map(mapper.minha), { pagina, porPagina, total });
});

const ver = catchAsync(async (req, res) => {
  const { denuncia, podeVerDenunciante, daModeracao } = await consultaService.ver(
    req.contexto,
    req.params.id
  );

  if (!daModeracao) return resposta.ok(res, mapper.minha(denuncia));

  resposta.ok(res, podeVerDenunciante ? mapper.itemComDenunciante(denuncia) : mapper.item(denuncia));
});

const resolver = catchAsync(async (req, res) => {
  const denuncia = await resolucaoService.resolver(req.contexto, req.params.id, req.body);
  resposta.ok(res, mapper.item(denuncia), { mensagem: 'Denúncia resolvida.' });
});

module.exports = { criar, listar, agrupadas, minhas, ver, resolver };
