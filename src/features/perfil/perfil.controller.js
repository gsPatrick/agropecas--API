'use strict';

const consultaService = require('./perfil.consulta.service');
const listagemService = require('./perfil.listagem.service');
const edicaoService = require('./perfil.edicao.service');
const verificacaoService = require('./perfil.verificacao.service');
const horarioService = require('./perfil.horario.service');
const vinculoService = require('./perfil.vinculo.service');
const mapper = require('./perfil.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');
const { erros } = require('../../utils/erros');
const { pode } = require('../../rbac');

/**
 * Camada HTTP e só ela. Nenhum `if` de regra de negócio: quem decide quem pode
 * o quê são os services, com `exigir(ctx, ...)`.
 *
 * O único `if` que sobra aqui é o de **enumeração**: quando o perfil não é seu
 * e você não tem escopo para vê-lo, a resposta é 404, não 403. Distinguir os
 * dois transformaria `PATCH /perfis/:id` num oráculo de "este id existe?".
 */

/** carrega o perfil do alvo da rota, sem revelar existência a quem não pode */
async function carregarAlvo(req) {
  const perfil = await consultaService.porId(req.params.id);
  if (!perfil) throw erros.naoEncontrado('Perfil');
  return perfil;
}

/** o perfil do próprio usuário logado — todas as rotas `/meu` passam por aqui */
async function carregarMeu(req) {
  const perfil = await consultaService.porUsuario(req.contexto.usuarioId);
  if (!perfil) throw erros.naoEncontrado('Perfil');
  return perfil;
}

// ─── leitura pública ────────────────────────────────────────────

const listarPublico = catchAsync(async (req, res) => {
  const { itens, meta } = await listagemService.listar(req.query);
  resposta.paginado(res, itens, meta);
});

/* um UUID também casa com o formato de slug (hex e hífen), então a mesma rota
   atende os dois: o link público do Google usa slug, e a tela do Admin usa id.
   Duas rotas separadas colidiriam em `/perfis/:algo` de qualquer jeito */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ver = catchAsync(async (req, res) => {
  const referencia = req.params.slug;

  if (UUID.test(referencia)) {
    const perfil = await consultaService.porId(referencia);
    if (!perfil) throw erros.naoEncontrado('Perfil');

    /* `detalhar` decide sozinho entre visão pública e completa, pelo escopo —
       visitante que descobrir um id continua vendo só o público */
    return resposta.ok(res, await consultaService.detalhar(perfil, req.contexto));
  }

  const dados = await consultaService.publicoPorSlug(referencia);

  /* fora do caminho da resposta de propósito: contar visita não pode custar
     latência na rota mais lida do sistema */
  consultaService.contabilizarVisualizacao(dados.id);

  return resposta.ok(res, dados);
});

// ─── meu perfil ─────────────────────────────────────────────────

const verMeu = catchAsync(async (req, res) => {
  const perfil = await carregarMeu(req);
  resposta.ok(res, mapper.privado(perfil, { comDocumento: true }));
});

const atualizarMeu = catchAsync(async (req, res) => {
  const perfil = await carregarMeu(req);
  const { ignorados } = await edicaoService.atualizar(perfil, req.body, req.contexto);

  const atualizado = await consultaService.porId(perfil.id);
  resposta.ok(res, mapper.privado(atualizado, { comDocumento: true }), {
    /* devolver o que foi descartado evita o suporte "salvei e não gravou":
       o campo não pertence a este tipo de perfil e o front consegue dizer isso */
    camposIgnorados: ignorados,
  });
});

// ─── perfil de terceiro (Admin) ─────────────────────────────────

const atualizarPorId = catchAsync(async (req, res) => {
  const perfil = await carregarAlvo(req);

  if (!edicaoService.podeEditar(req.contexto, perfil)) throw erros.naoEncontrado('Perfil');

  const { ignorados } = await edicaoService.atualizar(perfil, req.body, req.contexto);
  const atualizado = await consultaService.porId(perfil.id);

  resposta.ok(res, mapper.privado(atualizado, { comDocumento: true }), {
    camposIgnorados: ignorados,
  });
});

const removerPorId = catchAsync(async (req, res) => {
  const perfil = await carregarAlvo(req);

  if (!pode(req.contexto, 'perfil.remover', { donoId: perfil.usuario_id })) {
    throw erros.naoEncontrado('Perfil');
  }

  resposta.ok(res, await edicaoService.remover(perfil, req.body, req.contexto));
});

// ─── verificação (selo) ─────────────────────────────────────────

const verificar = catchAsync(async (req, res) => {
  const perfil = await carregarAlvo(req);
  await verificacaoService.verificar(perfil, req.body, req.contexto);

  resposta.ok(res, mapper.privado(perfil, { comDocumento: true }), {
    mensagem: 'Perfil verificado.',
  });
});

const revogarVerificacao = catchAsync(async (req, res) => {
  const perfil = await carregarAlvo(req);
  await verificacaoService.revogar(perfil, req.body, req.contexto);

  resposta.ok(res, mapper.privado(perfil, { comDocumento: true }), {
    mensagem: 'Selo de verificação removido.',
  });
});

// ─── horários ───────────────────────────────────────────────────

const listarHorarios = catchAsync(async (req, res) => {
  const perfil = await carregarMeu(req);
  const horarios = await horarioService.listar(perfil.id);
  resposta.ok(res, horarios.map(mapper.horario));
});

const definirHorarios = catchAsync(async (req, res) => {
  const perfil = await carregarMeu(req);
  const horarios = await horarioService.definir(perfil, req.body.horarios, req.contexto);
  resposta.ok(res, horarios.map(mapper.horario));
});

const removerHorario = catchAsync(async (req, res) => {
  const perfil = await carregarMeu(req);
  resposta.ok(res, await horarioService.remover(perfil, req.params.dia, req.contexto));
});

// ─── vínculos: serviços · marcas · área de atendimento ──────────

const listarVinculos = catchAsync(async (req, res) => {
  const perfil = await carregarMeu(req);
  const itens = await vinculoService.listar(perfil.id, req.params.colecao);
  resposta.ok(res, itens.map(mapper.vinculo));
});

const definirVinculos = catchAsync(async (req, res) => {
  const perfil = await carregarMeu(req);
  const itens = await vinculoService.definir(
    perfil,
    req.params.colecao,
    req.body.itens,
    req.contexto
  );
  resposta.ok(res, itens.map(mapper.vinculo));
});

const vincular = catchAsync(async (req, res) => {
  const perfil = await carregarMeu(req);
  const registro = await vinculoService.vincular(
    perfil,
    req.params.colecao,
    req.body,
    req.contexto
  );
  resposta.criado(res, mapper.vinculo(registro));
});

const desvincular = catchAsync(async (req, res) => {
  const perfil = await carregarMeu(req);
  resposta.ok(
    res,
    await vinculoService.desvincular(perfil, req.params.colecao, req.params.alvoId, req.contexto)
  );
});

module.exports = {
  listarPublico,
  ver,
  verMeu,
  atualizarMeu,
  atualizarPorId,
  removerPorId,
  verificar,
  revogarVerificacao,
  listarHorarios,
  definirHorarios,
  removerHorario,
  listarVinculos,
  definirVinculos,
  vincular,
  desvincular,
};
