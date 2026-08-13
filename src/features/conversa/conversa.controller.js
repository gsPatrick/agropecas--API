'use strict';

const inicioService = require('./conversa.inicio.service');
const consultaService = require('./conversa.consulta.service');
const historicoService = require('./conversa.historico.service');
const mensagemService = require('./conversa.mensagem.service');
const estadoService = require('./conversa.estado.service');
const moderacaoService = require('./conversa.moderacao.service');
const bloqueioService = require('./conversa.bloqueio.service');
const mapper = require('./conversa.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

/**
 * Controller — camada HTTP e só ela. Nenhuma decisão de acesso mora aqui: a
 * conferência de participação é do `conversa.acesso.service`, chamado por todo
 * service da feature. Espalhar `if` de permissão pelo controller é como se
 * garante que um dia um endpoint novo esqueça a checagem.
 */

const iniciar = catchAsync(async (req, res) => {
  const { conversa, criada } = await inicioService.iniciar(req.body, req.contexto);

  /* a primeira mensagem é opcional e vai pelo caminho normal de envio — o que
     garante contador, prévia, tempo real e notificação idênticos aos demais */
  if (req.body.mensagem) {
    await mensagemService.enviar(req.contexto, conversa.id, { conteudo: req.body.mensagem });
  }

  const { participante } = await consultaService.detalhe(req.contexto, conversa.id);
  const corpo = mapper.detalhe(participante, { usuarioId: req.contexto.usuarioId });

  /* 200 quando a conversa já existia: 201 mentiria dizendo que criou */
  return criada ? resposta.criado(res, corpo) : resposta.ok(res, corpo);
});

const listar = catchAsync(async (req, res) => {
  const { pagina, porPagina, arquivadas } = req.query;

  const { itens, total } = await consultaService.listar(req.contexto, {
    pagina,
    porPagina,
    arquivadas,
  });

  resposta.paginado(
    res,
    itens.map((item) => mapper.item(item, { usuarioId: req.contexto.usuarioId })),
    { pagina, porPagina, total }
  );
});

const naoLidas = catchAsync(async (req, res) => {
  resposta.ok(res, { total: await consultaService.totalNaoLidas(req.contexto.usuarioId) });
});

const detalhar = catchAsync(async (req, res) => {
  const { participante, moderacao } = await consultaService.detalhe(req.contexto, req.params.id);

  resposta.ok(res, {
    ...mapper.detalhe(participante, { usuarioId: req.contexto.usuarioId }),
    moderacao,
  });
});

const mensagens = catchAsync(async (req, res) => {
  const { itens, proximoCursor } = await historicoService.mensagens(req.contexto, req.params.id, {
    antesDe: req.query.antesDe,
    limite: req.query.limite,
  });

  resposta.ok(
    res,
    itens.map((item) => mapper.mensagem(item, { usuarioId: req.contexto.usuarioId })),
    { proximoCursor, temMais: Boolean(proximoCursor) }
  );
});

const enviar = catchAsync(async (req, res) => {
  const mensagem = await mensagemService.enviar(req.contexto, req.params.id, req.body);

  resposta.criado(res, mapper.mensagem(mensagem, { usuarioId: req.contexto.usuarioId }));
});

const marcarLida = catchAsync(async (req, res) => {
  resposta.ok(res, await mensagemService.marcarLida(req.contexto, req.params.id));
});

const arquivar = catchAsync(async (req, res) => {
  resposta.ok(res, await estadoService.arquivar(req.contexto, req.params.id, true));
});

const desarquivar = catchAsync(async (req, res) => {
  resposta.ok(res, await estadoService.arquivar(req.contexto, req.params.id, false));
});

const encerrar = catchAsync(async (req, res) => {
  resposta.ok(res, await estadoService.encerrar(req.contexto, req.params.id, req.body));
});

const removerMensagem = catchAsync(async (req, res) => {
  resposta.ok(res, await moderacaoService.removerMensagem(req.contexto, req.params.id, req.body));
});

const listarBloqueios = catchAsync(async (req, res) => {
  const itens = await bloqueioService.listar(req.contexto);
  resposta.ok(res, itens.map(mapper.bloqueio));
});

const bloquear = catchAsync(async (req, res) => {
  const { bloqueio, criado } = await bloqueioService.bloquear(req.contexto, req.body);
  const corpo = { id: bloqueio.id, usuarioId: bloqueio.bloqueado_id, motivo: bloqueio.motivo };

  return criado ? resposta.criado(res, corpo) : resposta.ok(res, corpo);
});

const desbloquear = catchAsync(async (req, res) => {
  resposta.ok(res, await bloqueioService.desbloquear(req.contexto, req.params.usuarioId));
});

module.exports = {
  iniciar,
  listar,
  naoLidas,
  detalhar,
  mensagens,
  enviar,
  marcarLida,
  arquivar,
  desarquivar,
  encerrar,
  removerMensagem,
  listarBloqueios,
  bloquear,
  desbloquear,
};
