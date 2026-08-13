'use strict';

const filaService = require('./moderacao.fila.service');
const painelService = require('./moderacao.painel.service');
const anuncioService = require('./moderacao.anuncio.service');
const conteudoService = require('./moderacao.conteudo.service');
const usuarioService = require('./moderacao.usuario.service');
const historicoService = require('./moderacao.historico.service');
const mapper = require('./moderacao.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');
const { erros } = require('../../utils/erros');

/**
 * Controller — só HTTP.
 *
 * Nenhuma trava de moderação mora aqui: escopo, motivo obrigatório e proibição
 * de agir sobre si mesmo são regras, e regra precisa valer também quando a
 * ação vier de um job da fila ou de um script de manutenção.
 */

const painel = catchAsync(async (req, res) => {
  resposta.ok(res, await painelService.contadores(req.contexto));
});

const fila = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await filaService.listar(req.contexto, req.query);
  resposta.paginado(res, mapper.fila(itens), { pagina, porPagina, total });
});

const verAnuncio = catchAsync(async (req, res) => {
  const anuncio = await filaService.ver(req.contexto, req.params.id);
  if (!anuncio) throw erros.naoEncontrado('Anúncio');

  resposta.ok(res, mapper.anuncioDetalhe(anuncio));
});

const aprovar = catchAsync(async (req, res) => {
  const anuncio = await anuncioService.aprovar(req.contexto, req.params.id, req.body);
  resposta.ok(res, mapper.decisao(anuncio), { mensagem: 'Anúncio aprovado.' });
});

const reprovar = catchAsync(async (req, res) => {
  const anuncio = await anuncioService.reprovar(req.contexto, req.params.id, req.body);
  resposta.ok(res, mapper.decisao(anuncio), { mensagem: 'Anúncio reprovado e retirado do ar.' });
});

const ocultar = catchAsync(async (req, res) => {
  const anuncio = await conteudoService.ocultar(req.contexto, req.params.id, req.body);
  resposta.ok(res, mapper.decisao(anuncio), { mensagem: 'Anúncio ocultado.' });
});

const bloquearFoto = catchAsync(async (req, res) => {
  const foto = await conteudoService.bloquearFoto(req.contexto, req.params.id, req.body);
  resposta.ok(res, mapper.foto(foto), { mensagem: 'Imagem bloqueada.' });
});

const suspender = catchAsync(async (req, res) => {
  const resultado = await usuarioService.suspender(req.contexto, req.params.id, req.body);
  resposta.ok(res, mapper.sancao(resultado), { mensagem: 'Conta suspensa e sessões encerradas.' });
});

const banir = catchAsync(async (req, res) => {
  const resultado = await usuarioService.banir(req.contexto, req.params.id, req.body);
  resposta.ok(res, mapper.sancao(resultado), { mensagem: 'Conta banida e sessões encerradas.' });
});

const restaurar = catchAsync(async (req, res) => {
  const resultado = await usuarioService.restaurar(req.contexto, req.params.id, req.body);
  resposta.ok(res, mapper.sancao(resultado), { mensagem: 'Conta reativada.' });
});

const historicoAnuncio = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await historicoService.doAnuncio(
    req.contexto,
    req.params.id,
    req.query
  );
  resposta.paginado(res, itens.map(mapper.historicoAnuncio), { pagina, porPagina, total });
});

const historicoUsuario = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await historicoService.doUsuario(
    req.contexto,
    req.params.id,
    req.query
  );
  resposta.paginado(res, itens.map(mapper.historicoUsuario), { pagina, porPagina, total });
});

module.exports = {
  painel,
  fila,
  verAnuncio,
  aprovar,
  reprovar,
  ocultar,
  bloquearFoto,
  suspender,
  banir,
  restaurar,
  historicoAnuncio,
  historicoUsuario,
};
