'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const db = require('../../models');
const config = require('../../config');
const pagamento = require('../../providers/pagamento');
const { exigir } = require('../../rbac');
const { AppError, erros } = require('../../utils/erros');
const { calcular } = require('./pedido.calculo');
const estoque = require('./pedido.estoque');
const estado = require('./pedido.estado.service');
const { NEGOCIACOES_COMPRAVEIS } = require('./pedido.constants');

/**
 * "Comprar agora" — do clique ao link do Checkout Pro.
 *
 * Ordem deliberada:
 *   1. confere o anúncio (só peça, à venda, com preço, de outra pessoa);
 *   2. numa transação: reserva o estoque e grava o pedido;
 *   3. FORA da transação: cria a preferência no Mercado Pago.
 *
 * Chamada externa dentro de transação seguraria a linha do anúncio travada
 * durante a ida ao MP — com a rede rural do comprador, segundos. Se o MP
 * falhar no passo 3, o pedido é cancelado e o estoque volta (`desfazer`).
 */

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function gerarCodigo(transacao) {
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const sufixo = Array.from({ length: 6 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('');
    const codigo = `PED-${sufixo}`;
    if (!(await db.Pedido.findOne({ where: { codigo }, attributes: ['id'], transaction: transacao }))) {
      return codigo;
    }
  }
  throw erros.interno('Não foi possível gerar o código do pedido.');
}

const naoCompravel = (mensagem, motivo) => new AppError(mensagem, 422, 'ANUNCIO_NAO_COMPRAVEL', { motivo });

function conferirAnuncio(anuncio, contexto) {
  if (!anuncio || anuncio.status !== 'publicado') {
    throw naoCompravel('Este anúncio não está disponível para compra.', 'indisponivel');
  }
  if (anuncio.tipo !== 'peca') {
    throw naoCompravel('Só peças podem ser compradas pela plataforma. Para serviços, fale com o prestador.', 'tipo');
  }
  if (!NEGOCIACOES_COMPRAVEIS.includes(anuncio.negociacao)) {
    throw naoCompravel('Este anúncio é só para troca.', 'negociacao');
  }
  if (anuncio.preco_a_combinar || !anuncio.preco_centavos || Number(anuncio.preco_centavos) <= 0) {
    throw naoCompravel('Este anúncio está com preço a combinar. Fale com o vendedor.', 'preco');
  }
  if (anuncio.usuario_id === contexto.usuarioId) {
    throw naoCompravel('Você não pode comprar o seu próprio anúncio.', 'proprio');
  }
}

/**
 * Pedido aberto do mesmo comprador para o mesmo anúncio, ainda reservado.
 *
 * É a idempotência do botão: o duplo clique, ou o "voltar" do navegador
 * seguido de outro "Comprar", devolve o MESMO checkout — sem segunda reserva
 * e sem segunda preferência no MP.
 */
const pedidoEmAberto = (contexto, anuncioId) =>
  db.Pedido.findOne({
    where: {
      comprador_id: contexto.usuarioId,
      anuncio_id: anuncioId,
      status: 'aguardando_pagamento',
      reservado_ate: { [Op.gt]: new Date() },
      checkout_url: { [Op.ne]: null },
    },
    order: [['criado_em', 'DESC']],
  });

async function desfazer(pedidoId, motivo) {
  await db.sequelize.transaction(async (transacao) => {
    const pedido = await estado.travar(pedidoId, transacao);
    if (!pedido || pedido.status !== 'aguardando_pagamento') return;
    await estoque.devolver(pedido, transacao);
    await estado.transicionar(pedido, 'cancelado', {
      motivo,
      campos: { cancelado_em: new Date(), cancelamento_motivo: motivo },
      transacao,
      origem: 'sistema',
    });
  });
}

/**
 * @returns {{ pedido, checkoutUrl, reaproveitado: boolean }}
 */
async function iniciar(contexto, { anuncioId, quantidade = 1 }) {
  exigir(contexto, 'pedido.comprar');

  /* falha cedo e com mensagem clara, antes de reservar a peça de alguém */
  if (!(await pagamento.configurado())) {
    throw new AppError('Pagamento online indisponível no momento.', 503, 'PAGAMENTO_INDISPONIVEL');
  }

  const existente = await pedidoEmAberto(contexto, anuncioId);
  if (existente) return { pedido: existente, checkoutUrl: existente.checkout_url, reaproveitado: true };

  const comprador = await db.Usuario.findByPk(contexto.usuarioId, { attributes: ['id', 'nome', 'email'] });
  if (!comprador) throw erros.naoAutenticado();

  const reservadoAte = new Date(Date.now() + config.pagamento.reservaMinutos * 60 * 1000);

  const pedido = await db.sequelize.transaction(async (transacao) => {
    /* trava o anúncio: o vendedor pausando no mesmo instante não pode
       deixar passar uma compra de anúncio que acabou de sair do ar */
    const anuncio = await db.Anuncio.findByPk(anuncioId, {
      transaction: transacao,
      lock: transacao.LOCK.UPDATE,
    });
    conferirAnuncio(anuncio, contexto);

    const reserva = await estoque.reservar(anuncio.id, quantidade, transacao);
    if (reserva === 'esgotado') {
      throw new AppError(
        anuncio.quantidade > 0
          ? `Só ${anuncio.quantidade} unidade(s) disponível(is).`
          : 'Esta peça acabou de ser vendida.',
        409,
        'ESTOQUE_INSUFICIENTE',
        { disponivel: anuncio.quantidade }
      );
    }

    const valores = calcular({
      precoUnitarioCentavos: anuncio.preco_centavos,
      quantidade,
      percentual: config.pagamento.comissaoPercentual,
    });

    return db.Pedido.create(
      {
        codigo: await gerarCodigo(transacao),
        comprador_id: contexto.usuarioId,
        vendedor_id: anuncio.usuario_id,
        anuncio_id: anuncio.id,
        titulo: anuncio.titulo,
        quantidade,
        preco_unitario_centavos: anuncio.preco_centavos,
        valor_total_centavos: valores.valorTotalCentavos,
        comissao_percentual: valores.comissaoPercentual,
        comissao_centavos: valores.comissaoCentavos,
        valor_vendedor_centavos: valores.valorVendedorCentavos,
        estoque_reservado: reserva === 'reservado',
        status: 'aguardando_pagamento',
        reservado_ate: reservadoAte,
      },
      { transaction: transacao }
    );
  });

  await estoque.invalidarAnuncio(anuncioId);

  let cobranca;
  try {
    cobranca = await pagamento.criarCobranca({
      pedido,
      comprador,
      expiraEm: reservadoAte,
      /* o id do pedido como chave: retentativa da SDK não cria duas preferências */
      idempotencia: `pedido-${pedido.id}`,
    });
  } catch (erro) {
    await desfazer(pedido.id, 'falha ao criar a cobrança no Mercado Pago');
    await estoque.invalidarAnuncio(anuncioId);
    throw erro;
  }

  await pedido.update({
    conta_mp_id: cobranca.contaId,
    mp_preferencia_id: cobranca.preferenciaId,
    checkout_url: cobranca.checkoutUrl,
  });

  return { pedido, checkoutUrl: cobranca.checkoutUrl, reaproveitado: false };
}

module.exports = { iniciar, conferirAnuncio };
