'use strict';

const catchAsync = require('../../../utils/catch-async');
const resposta = require('../../../utils/resposta');
const configuracaoService = require('../services/admin.plataforma.configuracao.service');
const planosService = require('../services/admin.plataforma.planos.service');
const rbacService = require('../services/admin.plataforma.rbac.service');

/**
 * Plataforma: configuração, planos e RBAC.
 *
 * Só HTTP. Nenhuma trava mora aqui — as cinco regras do RBAC estão no service,
 * porque precisam valer também quando a operação vier de um script de
 * manutenção ou de um job, e não só de uma requisição.
 */

/* ─── CONFIGURAÇÃO ─────────────────────────────────────────── */

const listarConfiguracoes = catchAsync(async (req, res) => {
  const { itens, grupos, mascaradas } = await configuracaoService.listar(req.contexto, {
    grupo: req.query.grupo,
  });

  resposta.ok(res, itens, { grupos, mascaradas });
});

const salvarConfiguracao = catchAsync(async (req, res) => {
  const item = await configuracaoService.salvar(req.contexto, {
    chave: req.params.chave,
    valor: req.body.valor,
    motivo: req.body.motivo,
  });

  resposta.ok(res, item, { mensagem: 'Configuração atualizada.' });
});

const historicoConfiguracao = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await configuracaoService.historico(
    req.contexto,
    req.params.chave,
    req.query
  );

  resposta.paginado(res, itens, { pagina, porPagina, total });
});

/* ─── PLANOS ───────────────────────────────────────────────── */

const listarPlanos = catchAsync(async (req, res) => {
  resposta.ok(res, await planosService.listar());
});

const criarPlano = catchAsync(async (req, res) => {
  resposta.criado(res, await planosService.criar(req.contexto, req.body));
});

const editarPlano = catchAsync(async (req, res) => {
  resposta.ok(res, await planosService.editar(req.contexto, req.params.id, req.body));
});

const definirLimites = catchAsync(async (req, res) => {
  const plano = await planosService.definirLimites(req.contexto, req.params.id, req.body.limites || []);
  resposta.ok(res, plano, { mensagem: 'Limites do plano atualizados.' });
});

const removerPlano = catchAsync(async (req, res) => {
  resposta.ok(res, await planosService.remover(req.contexto, req.params.id, { motivo: req.body?.motivo }));
});

const atribuirPlano = catchAsync(async (req, res) => {
  resposta.criado(res, await planosService.atribuir(req.contexto, req.body));
});

/* ─── RBAC ─────────────────────────────────────────────────── */

const listarPapeis = catchAsync(async (req, res) => {
  resposta.ok(res, await rbacService.listarPapeis());
});

const listarPermissoes = catchAsync(async (req, res) => {
  const { total, porRecurso } = await rbacService.listarPermissoes();
  resposta.ok(res, porRecurso, { total });
});

const criarPapel = catchAsync(async (req, res) => {
  resposta.criado(res, await rbacService.criarPapel(req.contexto, req.body));
});

const editarPapel = catchAsync(async (req, res) => {
  resposta.ok(res, await rbacService.editarPapel(req.contexto, req.params.id, req.body));
});

const removerPapel = catchAsync(async (req, res) => {
  resposta.ok(res, await rbacService.removerPapel(req.contexto, req.params.id));
});

module.exports = {
  listarConfiguracoes,
  salvarConfiguracao,
  historicoConfiguracao,
  listarPlanos,
  criarPlano,
  editarPlano,
  definirLimites,
  removerPlano,
  atribuirPlano,
  listarPapeis,
  listarPermissoes,
  criarPapel,
  editarPapel,
  removerPapel,
};
