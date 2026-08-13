'use strict';

const consultaService = require('./plano.consulta.service');
const adminService = require('./plano.admin.service');
const assinaturaService = require('./plano.assinatura.service');
const limiteService = require('./plano.limite.service');
const mapper = require('./plano.mapper');
const { pode } = require('../../rbac');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');
const { lerPaginacao } = require('../../utils/paginacao');

/**
 * Camada HTTP e só ela. Nenhuma decisão de negócio mora aqui — o único `if`
 * que sobrou é o que escolhe QUAL mapper usar, e isso é formatação de saída,
 * não regra.
 */

const listar = catchAsync(async (req, res) => {
  /* o Admin enxerga plano oculto e inativo na mesma rota da vitrine: duas
     rotas quase idênticas divergiriam na primeira mudança de campo */
  const admin = pode(req.contexto, 'plano.editar');
  const incluirInativos = admin && req.query.incluirInativos === true;
  const incluirOcultos = admin && req.query.incluirOcultos === true;

  const planos = await consultaService.listar({ incluirInativos, incluirOcultos });

  resposta.ok(res, planos.map(admin ? mapper.planoAdmin : mapper.plano));
});

const obter = catchAsync(async (req, res) => {
  const plano = await consultaService.obter(req.params.id);
  resposta.ok(res, pode(req.contexto, 'plano.editar') ? mapper.planoAdmin(plano) : mapper.plano(plano));
});

const criar = catchAsync(async (req, res) => {
  const plano = await adminService.criar(req.body, req.contexto);
  resposta.criado(res, mapper.planoAdmin(plano));
});

const editar = catchAsync(async (req, res) => {
  const plano = await adminService.editar(req.params.id, req.body, req.contexto);
  resposta.ok(res, mapper.planoAdmin(plano));
});

const remover = catchAsync(async (req, res) => {
  resposta.ok(res, await adminService.remover(req.params.id, req.contexto, { motivo: req.body?.motivo }));
});

const definirLimites = catchAsync(async (req, res) => {
  const plano = await adminService.definirLimites(req.params.id, req.body.limites, req.contexto);
  resposta.ok(res, mapper.planoAdmin(plano));
});

const atribuir = catchAsync(async (req, res) => {
  const assinatura = await assinaturaService.atribuir(req.body, req.contexto);
  resposta.criado(res, mapper.assinatura(assinatura));
});

const minhaAssinatura = catchAsync(async (req, res) => {
  resposta.ok(res, mapper.minhaAssinatura(await assinaturaService.minha(req.contexto.usuarioId)));
});

/**
 * "Posso publicar mais um?" — a mesma pergunta que o módulo de anúncio faz
 * internamente, exposta para a tela poder desabilitar o botão antes do envio.
 *
 * Sempre sobre o PRÓPRIO usuário: o id sai do contexto, nunca da query. Deixar
 * consultar a quota de terceiro entregaria de graça a informação de quanto o
 * concorrente já publicou.
 */
const meuLimite = catchAsync(async (req, res) => {
  resposta.ok(res, await limiteService.podeUsar(req.contexto.usuarioId, req.params.chave, 1));
});

const meuHistorico = catchAsync(async (req, res) => {
  const { pagina, porPagina, limit, offset } = lerPaginacao(req.query);
  const { rows, count } = await assinaturaService.historico(req.contexto.usuarioId, { limit, offset });

  resposta.paginado(res, rows.map(mapper.assinatura), { pagina, porPagina, total: count });
});

module.exports = {
  listar,
  obter,
  criar,
  editar,
  remover,
  definirLimites,
  atribuir,
  minhaAssinatura,
  meuLimite,
  meuHistorico,
};
