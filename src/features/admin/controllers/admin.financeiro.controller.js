'use strict';

const catchAsync = require('../../../utils/catch-async');
const resposta = require('../../../utils/resposta');
const consultaService = require('../../pedido/pedido.consulta.service');
const acoesService = require('../../pedido/pedido.acoes.service');
const repasseService = require('../../pedido/pedido.repasse.service');
const mapper = require('../../pedido/pedido.mapper');
const contasService = require('../services/admin.plataforma.contas-pagamento.service');

/**
 * Financeiro: vendas, custódia e repasses (Maturacao/06).
 *
 * Composição, não regra: liberar repasse é o mesmo `confirmarRecebimento`
 * do comprador (com escopo `todos`), e estornar é o mesmo caminho do
 * webhook. Ver o cabeçalho de `admin.routes.js`.
 */

const comMeta = (res, itens, { pagina, porPagina, total, resumo }) =>
  res.status(200).json({
    sucesso: true,
    dados: itens,
    meta: { pagina, porPagina, total, totalPaginas: Math.max(1, Math.ceil(total / porPagina)), resumo },
  });

const listarVendas = catchAsync(async (req, res) => {
  const resultado = await consultaService.listarAdmin(req.contexto, req.query);
  const emCustodia = Number(await repasseService.emCustodia()) || 0;
  comMeta(res, mapper.lista(resultado.itens, { visao: 'admin' }), {
    ...resultado,
    resumo: { ...resultado.resumo, emCustodiaCentavos: emCustodia },
  });
});

const verVenda = catchAsync(async (req, res) => {
  const { pedido } = await consultaService.detalhar(req.contexto, req.params.id);
  resposta.ok(res, mapper.pedido(pedido, { visao: 'admin' }));
});

const liberarRepasse = catchAsync(async (req, res) => {
  await acoesService.confirmarRecebimento(req.contexto, req.params.id, req.body);
  const { pedido } = await consultaService.detalhar(req.contexto, req.params.id);
  resposta.ok(res, mapper.pedido(pedido, { visao: 'admin' }), { mensagem: 'Repasse liberado.' });
});

const reembolsar = catchAsync(async (req, res) => {
  await acoesService.reembolsar(req.contexto, req.params.id, req.body);
  const { pedido } = await consultaService.detalhar(req.contexto, req.params.id);
  resposta.ok(res, mapper.pedido(pedido, { visao: 'admin' }), { mensagem: 'Estorno solicitado ao Mercado Pago.' });
});

const cancelar = catchAsync(async (req, res) => {
  await acoesService.cancelar(req.contexto, req.params.id, req.body);
  const { pedido } = await consultaService.detalhar(req.contexto, req.params.id);
  resposta.ok(res, mapper.pedido(pedido, { visao: 'admin' }), { mensagem: 'Pedido cancelado.' });
});

const listarRepasses = catchAsync(async (req, res) => {
  const resultado = await repasseService.listarAdmin(req.contexto, req.query);
  comMeta(res, resultado.itens.map(mapper.itemRepasseAdmin), resultado);
});

const pagarRepasse = catchAsync(async (req, res) => {
  const repasse = await repasseService.registrarPagamento(req.contexto, req.params.id, req.body);
  resposta.ok(res, { id: repasse.id, status: repasse.status, pagoEm: repasse.pago_em }, { mensagem: 'PIX registrado.' });
});

/* ─── CONTAS DO MERCADO PAGO ───────────────────────────────── */

const listarContas = catchAsync(async (req, res) => {
  const { itens, ...meta } = await contasService.listar();
  resposta.ok(res, itens, meta);
});

const criarConta = catchAsync(async (req, res) => {
  const conta = await contasService.criar(req.contexto, req.body);
  resposta.ok(res, conta, { mensagem: 'Conta cadastrada.' });
});

const editarConta = catchAsync(async (req, res) => {
  const conta = await contasService.editar(req.contexto, req.params.id, req.body);
  resposta.ok(res, conta, { mensagem: 'Conta atualizada.' });
});

const testarConta = catchAsync(async (req, res) => {
  const conta = await contasService.testar(req.contexto, req.params.id);
  resposta.ok(res, conta, { mensagem: 'Conexão com o Mercado Pago confirmada.' });
});

const ativarConta = catchAsync(async (req, res) => {
  const conta = await contasService.ativar(req.contexto, req.params.id);
  resposta.ok(res, conta, { mensagem: 'Esta conta agora recebe os pagamentos novos.' });
});

const removerConta = catchAsync(async (req, res) => {
  await contasService.remover(req.contexto, req.params.id);
  resposta.ok(res, { removida: true }, { mensagem: 'Conta removida.' });
});

module.exports = {
  listarVendas,
  verVenda,
  liberarRepasse,
  reembolsar,
  cancelar,
  listarRepasses,
  pagarRepasse,
  listarContas,
  criarConta,
  editarConta,
  testarConta,
  ativarConta,
  removerConta,
};
