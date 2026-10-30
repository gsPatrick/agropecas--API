'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const auditoria = require('../auditoria');
const { exigir, escopoDe } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { lerPaginacao } = require('../../utils/paginacao');
const estado = require('./pedido.estado.service');
const aviso = require('./pedido.aviso');
const { normalizarChavePix } = require('./pedido.validators');

/**
 * Repasses — o lado "carteira" do vendedor.
 *
 * O PIX é feito pela Admin fora do sistema (MVP: sem integração de payout).
 * O sistema guarda o QUANTO, o PARA ONDE (chave PIX) e o QUANDO — e só deixa
 * registrar pagamento do que está `disponivel`, nunca do que ainda está
 * retido em custódia.
 */

/** soma por status em centavos — o cabeçalho do extrato */
async function totaisPorStatus(where) {
  const linhas = await db.Repasse.findAll({
    where,
    attributes: ['status', [db.sequelize.fn('SUM', db.sequelize.col('valor_centavos')), 'total'], [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'quantidade']],
    group: ['status'],
    raw: true,
  });

  const totais = { retido: 0, disponivel: 0, pago: 0, cancelado: 0 };
  const quantidades = { retido: 0, disponivel: 0, pago: 0, cancelado: 0 };
  for (const linha of linhas) {
    totais[linha.status] = Number(linha.total) || 0;
    quantidades[linha.status] = Number(linha.quantidade) || 0;
  }
  return { totais, quantidades };
}

const INCLUIR_PEDIDO = {
  model: db.Pedido,
  as: 'pedido',
  attributes: ['id', 'codigo', 'titulo', 'quantidade', 'valor_total_centavos', 'comissao_centavos', 'status', 'pago_em', 'entregue_em', 'anuncio_id'],
};

/** extrato do próprio vendedor */
async function extrato(contexto, query = {}) {
  exigir(contexto, 'repasse.ler');
  const { pagina, porPagina, offset, limit } = lerPaginacao(query);
  const where = { vendedor_id: contexto.usuarioId };
  if (query.status) where.status = query.status;

  const [{ rows, count }, resumo, perfil] = await Promise.all([
    db.Repasse.findAndCountAll({ where, include: [INCLUIR_PEDIDO], order: [['criado_em', 'DESC']], offset, limit }),
    totaisPorStatus({ vendedor_id: contexto.usuarioId }),
    db.Perfil.findOne({ where: { usuario_id: contexto.usuarioId }, attributes: ['chave_pix', 'chave_pix_tipo'] }),
  ]);

  return {
    itens: rows,
    pagina,
    porPagina,
    total: count,
    resumo: { ...resumo, chavePixCadastrada: Boolean(perfil?.chave_pix) },
  };
}

async function lerChavePix(contexto) {
  exigir(contexto, 'repasse.configurar_pix');
  const perfil = await db.Perfil.findOne({ where: { usuario_id: contexto.usuarioId }, attributes: ['chave_pix', 'chave_pix_tipo'] });
  if (!perfil) throw erros.naoEncontrado('Perfil');
  return perfil;
}

async function salvarChavePix(contexto, { chavePix: digitada, chavePixTipo }) {
  const chavePix = normalizarChavePix(chavePixTipo, digitada);
  exigir(contexto, 'repasse.configurar_pix');
  const perfil = await db.Perfil.findOne({ where: { usuario_id: contexto.usuarioId } });
  if (!perfil) throw erros.naoEncontrado('Perfil');

  const antes = { chave_pix: perfil.chave_pix, chave_pix_tipo: perfil.chave_pix_tipo };
  await perfil.update({ chave_pix: chavePix, chave_pix_tipo: chavePixTipo });

  /* trocar a chave muda para onde vai dinheiro: é o tipo de alteração que
     precisa de rastro quando o vendedor disser "não fui eu" */
  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: 'perfis',
    entidadeId: perfil.id,
    antes,
    depois: { chave_pix: chavePix, chave_pix_tipo: chavePixTipo },
    motivo: 'chave PIX de recebimento',
  });

  return perfil;
}

// ─── ADMIN ────────────────────────────────────────────────────────

async function listarAdmin(contexto, query = {}) {
  if (escopoDe(contexto, 'repasse.ler') !== 'todos') throw erros.semPermissao();
  const { pagina, porPagina, offset, limit } = lerPaginacao(query);

  const where = {};
  if (query.status) where.status = query.status;
  if (query.vendedorId) where.vendedor_id = query.vendedorId;

  const [{ rows, count }, resumo] = await Promise.all([
    db.Repasse.findAndCountAll({
      where,
      include: [
        INCLUIR_PEDIDO,
        {
          model: db.Usuario,
          as: 'vendedor',
          attributes: ['id', 'nome', 'email'],
          include: [{ model: db.Perfil, as: 'perfil', attributes: ['id', 'nome_exibicao', 'chave_pix', 'chave_pix_tipo'] }],
        },
      ],
      /* o que espera PIX há mais tempo vem primeiro */
      order: [['disponivel_em', 'ASC NULLS LAST'], ['criado_em', 'DESC']],
      offset,
      limit,
    }),
    totaisPorStatus({}),
  ]);

  return { itens: rows, pagina, porPagina, total: count, resumo };
}

/**
 * Registra o PIX feito pela Admin. Copia a chave PIX do momento para o
 * repasse e fecha o pedido como `concluido`.
 */
async function registrarPagamento(contexto, repasseId, { comprovante, observacao }) {
  if (escopoDe(contexto, 'repasse.pagar') !== 'todos') throw erros.semPermissao();

  const resultado = await db.sequelize.transaction(async (transacao) => {
    const repasse = await db.Repasse.findByPk(repasseId, { transaction: transacao, lock: transacao.LOCK.UPDATE });
    if (!repasse) throw erros.naoEncontrado('Repasse');
    if (repasse.status !== 'disponivel') {
      throw erros.conflito(
        repasse.status === 'retido'
          ? 'Este valor ainda está em custódia: o recebimento não foi confirmado.'
          : `Este repasse está "${repasse.status}" e não pode ser pago.`
      );
    }

    const perfil = await db.Perfil.findOne({
      where: { usuario_id: repasse.vendedor_id },
      attributes: ['chave_pix', 'chave_pix_tipo'],
      transaction: transacao,
    });
    if (!perfil?.chave_pix) {
      throw erros.conflito('O vendedor ainda não cadastrou a chave PIX de recebimento.');
    }

    await repasse.update(
      {
        status: 'pago',
        pago_em: new Date(),
        pago_por: contexto.usuarioId,
        chave_pix: perfil.chave_pix,
        chave_pix_tipo: perfil.chave_pix_tipo,
        comprovante: comprovante || null,
        observacao: observacao || null,
      },
      { transaction: transacao }
    );

    const pedido = await estado.travar(repasse.pedido_id, transacao);
    if (pedido && estado.podeIr(pedido.status, 'concluido')) {
      await estado.transicionar(pedido, 'concluido', {
        contexto,
        motivo: 'repasse pago ao vendedor',
        dados: { repasseId: repasse.id, comprovante: comprovante || null },
        transacao,
      });
    }

    return { repasse, pedido };
  });

  if (resultado.pedido) await aviso.repassePago(resultado.pedido, resultado.repasse);
  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: 'repasses',
    entidadeId: resultado.repasse.id,
    depois: { status: 'pago', valorCentavos: Number(resultado.repasse.valor_centavos), comprovante: comprovante || null },
    motivo: 'PIX de repasse registrado',
  });

  return resultado.repasse;
}

/** "a plataforma deve aos vendedores" — usado no painel financeiro */
const emCustodia = () =>
  db.Repasse.sum('valor_centavos', { where: { status: { [Op.in]: ['retido', 'disponivel'] } } });

module.exports = { extrato, lerChavePix, salvarChavePix, listarAdmin, registrarPagamento, emCustodia, totaisPorStatus };
