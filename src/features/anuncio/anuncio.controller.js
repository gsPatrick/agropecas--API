'use strict';

const criacaoService = require('./anuncio.criacao.service');
const edicaoService = require('./anuncio.edicao.service');
const publicacaoService = require('./anuncio.publicacao.service');
const retiradaService = require('./anuncio.retirada.service');
const consultaService = require('./anuncio.consulta.service');
const parecidosService = require('./anuncio.parecidos.service');
const fotoService = require('./anuncio.foto.service');
const metricaService = require('./anuncio.metrica.service');
const historicoService = require('./anuncio.historico.service');
const acesso = require('./anuncio.acesso.service');
const campos = require('./anuncio.campos');
const mapper = require('./anuncio.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

/**
 * Camada HTTP e só ela: lê a requisição, chama um service, devolve.
 *
 * Nenhuma regra de negócio mora aqui — nem o `if` de "pode ver isso?", que
 * seria a primeira a aparecer e a primeira a divergir entre duas rotas. Quem
 * decide escopo é o RBAC, dentro do service, onde o dono do registro é
 * conhecido.
 */

/** o detalhe completo é a resposta padrão de toda escrita: o front redesenha a tela */
const devolverDetalhe = async (contexto, id) => (await consultaService.detalhe(contexto, id)).anuncio;

const criar = catchAsync(async (req, res) => {
  const anuncio = await criacaoService.criar(req.contexto, req.body);

  /* atalho do formulário "salvar e publicar": duas ações, uma requisição */
  if (req.body.publicar) await publicacaoService.publicar(req.contexto, anuncio.id);

  resposta.criado(res, await devolverDetalhe(req.contexto, anuncio.id), {
    mensagem: req.body.publicar ? 'Anúncio publicado.' : 'Rascunho salvo.',
  });
});

const editar = catchAsync(async (req, res) => {
  const anuncio = await edicaoService.editar(req.contexto, req.params.id, req.body);
  resposta.ok(res, await devolverDetalhe(req.contexto, anuncio.id));
});

const remover = catchAsync(async (req, res) => {
  resposta.ok(res, await retiradaService.remover(req.contexto, req.params.id, req.body));
});

const publicar = catchAsync(async (req, res) => {
  const anuncio = await publicacaoService.publicar(req.contexto, req.params.id);
  resposta.ok(res, await devolverDetalhe(req.contexto, anuncio.id), {
    mensagem: 'Anúncio publicado.',
  });
});

const pausar = catchAsync(async (req, res) => {
  const anuncio = await publicacaoService.pausar(req.contexto, req.params.id, req.body);
  resposta.ok(res, await devolverDetalhe(req.contexto, anuncio.id), { mensagem: 'Anúncio pausado.' });
});

const renovar = catchAsync(async (req, res) => {
  const anuncio = await publicacaoService.renovar(req.contexto, req.params.id);
  resposta.ok(res, await devolverDetalhe(req.contexto, anuncio.id), {
    mensagem: 'Anúncio renovado.',
  });
});

const ocultar = catchAsync(async (req, res) => {
  const anuncio = await retiradaService.ocultar(req.contexto, req.params.id, req.body);
  resposta.ok(res, await devolverDetalhe(req.contexto, anuncio.id), {
    mensagem: 'Anúncio ocultado.',
  });
});

const listar = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await consultaService.vitrine(req.query);
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const listarMeus = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await consultaService.meus(req.contexto, req.query);
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const detalhar = catchAsync(async (req, res) => {
  const { anuncio, dono } = await consultaService.detalhe(req.contexto, req.params.id);

  /* a visita do próprio anunciante não conta: ele abre o anúncio dez vezes por
     dia para conferir o texto, e isso não é interesse de comprador */
  if (!dono) await metricaService.registrarVisualizacao(req.contexto, anuncio.id);

  resposta.ok(res, anuncio);
});

const parecidos = catchAsync(async (req, res) => {
  resposta.ok(res, await parecidosService.parecidos(req.params.id));
});

const vincularFotos = catchAsync(async (req, res) => {
  const anuncio = await acesso.paraAcao(req.contexto, req.params.id, 'anuncio.editar');
  await fotoService.vincular(req.contexto, anuncio, req.body.arquivos);
  await campos.invalidar(anuncio.id);

  resposta.criado(res, (await fotoService.listar(anuncio.id)).map(mapper.foto));
});

const removerFoto = catchAsync(async (req, res) => {
  const anuncio = await acesso.paraAcao(req.contexto, req.params.id, 'anuncio.editar');
  await fotoService.remover(req.contexto, anuncio, req.params.fotoId);
  await campos.invalidar(anuncio.id);

  resposta.ok(res, (await fotoService.listar(anuncio.id)).map(mapper.foto));
});

const reordenarFotos = catchAsync(async (req, res) => {
  const anuncio = await acesso.paraAcao(req.contexto, req.params.id, 'anuncio.editar');
  const fotos = await fotoService.reordenar(req.contexto, anuncio, req.body.ordem);
  await campos.invalidar(anuncio.id);

  resposta.ok(res, fotos.map(mapper.foto));
});

const definirCapa = catchAsync(async (req, res) => {
  const anuncio = await acesso.paraAcao(req.contexto, req.params.id, 'anuncio.editar');
  const fotos = await fotoService.definirCapa(req.contexto, anuncio, req.params.fotoId);
  await campos.invalidar(anuncio.id);

  resposta.ok(res, fotos.map(mapper.foto));
});

const historico = catchAsync(async (req, res) => {
  const itens = await historicoService.listar(req.contexto, req.params.id);
  resposta.ok(res, itens.map(mapper.historico));
});

const metricas = catchAsync(async (req, res) => {
  const dados = await metricaService.resumo(req.contexto, req.params.id, { dias: req.query.dias });
  resposta.ok(res, { ...dados, serie: dados.serie.map(mapper.metricaDiaria) });
});

const contatos = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await metricaService.contatos(
    req.contexto,
    req.params.id,
    req.query
  );
  resposta.paginado(res, itens.map(mapper.contato), { pagina, porPagina, total });
});

const registrarContato = catchAsync(async (req, res) => {
  resposta.ok(res, await metricaService.registrarContato(req.contexto, req.params.id, req.body));
});

module.exports = {
  criar,
  editar,
  remover,
  publicar,
  pausar,
  renovar,
  ocultar,
  listar,
  listarMeus,
  detalhar,
  parecidos,
  vincularFotos,
  removerFoto,
  reordenarFotos,
  definirCapa,
  historico,
  metricas,
  contatos,
  registrarContato,
};
