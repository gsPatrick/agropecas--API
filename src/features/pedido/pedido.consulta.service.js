'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const { exigir, escopoDe } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { lerPaginacao } = require('../../utils/paginacao');
const { STATUS_COM_PAGAMENTO } = require('./pedido.constants');

/**
 * Leitura de pedidos: minhas compras, minhas vendas, o detalhe, e a visão
 * financeira da Admin.
 *
 * O escopo é aplicado no `where`, nunca depois: o comprador não recebe o
 * banco inteiro pela rede para o filtro acontecer no front.
 */

const capa = {
  model: db.Anuncio,
  as: 'anuncio',
  attributes: ['id', 'slug', 'codigo'],
  paranoid: false,
  include: [
    { model: db.AnuncioFoto, as: 'fotos', required: false, where: { principal: true }, attributes: ['id', 'url', 'url_thumb'] },
  ],
};

const pessoa = (as) => ({
  model: db.Usuario,
  as,
  attributes: ['id', 'nome'],
  include: [{ model: db.Perfil, as: 'perfil', attributes: ['id', 'slug', 'nome_exibicao'] }],
});

function filtroStatus(query) {
  if (!query.status) return {};
  return { status: query.status };
}

async function listarDoLado(contexto, query, coluna) {
  exigir(contexto, 'pedido.ler');
  const { pagina, porPagina, offset, limit } = lerPaginacao(query);

  const { rows, count } = await db.Pedido.findAndCountAll({
    where: { [coluna]: contexto.usuarioId, ...filtroStatus(query) },
    include: [capa, pessoa(coluna === 'comprador_id' ? 'vendedor' : 'comprador'), { model: db.Repasse, as: 'repasse', required: false }],
    order: [['criado_em', 'DESC']],
    offset,
    limit,
    distinct: true,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

const listarCompras = (contexto, query = {}) => listarDoLado(contexto, query, 'comprador_id');

/* venda que nunca foi paga não interessa ao vendedor: é reserva desistida */
const listarVendas = (contexto, query = {}) =>
  listarDoLado(contexto, { ...query, status: query.status || { [Op.notIn]: ['aguardando_pagamento', 'cancelado'] } }, 'vendedor_id');

/**
 * Detalhe. Comprador e vendedor do pedido leem; terceiro com `.todos` lê;
 * qualquer outro recebe 404 (não 403 — não confirma que o pedido existe).
 *
 * @returns {{ pedido, visao: 'comprador'|'vendedor'|'admin' }}
 */
async function detalhar(contexto, pedidoId) {
  const escopo = escopoDe(contexto, 'pedido.ler');
  if (!escopo) throw erros.semPermissao();

  const pedido = await db.Pedido.findByPk(pedidoId, {
    include: [
      capa,
      pessoa('comprador'),
      pessoa('vendedor'),
      { model: db.Repasse, as: 'repasse', required: false },
      { model: db.PedidoHistorico, as: 'historico', required: false },
    ],
    order: [[{ model: db.PedidoHistorico, as: 'historico' }, 'criado_em', 'ASC']],
  });
  if (!pedido) throw erros.naoEncontrado('Pedido');

  if (pedido.comprador_id === contexto.usuarioId) return { pedido, visao: 'comprador' };
  if (pedido.vendedor_id === contexto.usuarioId) return { pedido, visao: 'vendedor' };
  if (escopo === 'todos') return { pedido, visao: 'admin' };
  throw erros.naoEncontrado('Pedido');
}

/**
 * Vendas para a Admin, com o resumo financeiro do filtro aplicado:
 * bruto, comissão (receita da plataforma) e líquido dos vendedores.
 * Só entra na soma o que tem pagamento de fato — reserva que expirou não é
 * venda.
 */
async function listarAdmin(contexto, query = {}) {
  if (escopoDe(contexto, 'pedido.ler') !== 'todos') throw erros.semPermissao();
  const { pagina, porPagina, offset, limit } = lerPaginacao(query);

  const where = {};
  if (query.status) where.status = query.status;
  if (query.desde || query.ate) {
    where.criado_em = {};
    if (query.desde) where.criado_em[Op.gte] = new Date(query.desde);
    if (query.ate) where.criado_em[Op.lte] = new Date(query.ate);
  }
  if (query.busca) {
    where[Op.or] = [
      { codigo: { [Op.iLike]: `%${query.busca}%` } },
      { titulo: { [Op.iLike]: `%${query.busca}%` } },
    ];
  }

  const somaWhere = { ...where, status: query.status && STATUS_COM_PAGAMENTO.includes(query.status) ? query.status : { [Op.in]: STATUS_COM_PAGAMENTO } };
  const soma = (coluna) => db.Pedido.sum(coluna, { where: somaWhere });

  const [{ rows, count }, bruto, comissao, liquido, vendas] = await Promise.all([
    db.Pedido.findAndCountAll({
      where,
      include: [pessoa('comprador'), pessoa('vendedor'), { model: db.Repasse, as: 'repasse', required: false }],
      order: [['criado_em', 'DESC']],
      offset,
      limit,
      distinct: true,
    }),
    soma('valor_total_centavos'),
    soma('comissao_centavos'),
    soma('valor_vendedor_centavos'),
    db.Pedido.count({ where: somaWhere }),
  ]);

  return {
    itens: rows,
    pagina,
    porPagina,
    total: count,
    resumo: {
      vendas,
      brutoCentavos: Number(bruto) || 0,
      comissaoCentavos: Number(comissao) || 0,
      liquidoVendedoresCentavos: Number(liquido) || 0,
      emDisputa: await db.Pedido.count({ where: { status: 'em_disputa' } }),
    },
  };
}

module.exports = { listarCompras, listarVendas, detalhar, listarAdmin };
