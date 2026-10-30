'use strict';

/**
 * Model → JSON da API. Lista branca, sempre.
 *
 * A mesma venda é vista por três pessoas, e cada uma vê uma parte:
 *   comprador  o que pagou — não vê a comissão nem o líquido do vendedor
 *   vendedor   bruto, comissão e o que vai receber — não vê o PIX de ninguém
 *   admin      tudo, inclusive a chave PIX do repasse
 *
 * Dinheiro sai como inteiro em centavos (`...Centavos`), como no anúncio:
 * o front formata, ninguém soma float.
 */

const n = (valor) => (valor === null || valor === undefined ? null : Number(valor));

const capa = (anuncio) => {
  const foto = anuncio?.fotos?.[0];
  return foto ? { url: foto.url, miniatura: foto.url_thumb || foto.url } : null;
};

const pessoa = (usuario) =>
  usuario
    ? {
        id: usuario.id,
        nome: usuario.perfil?.nome_exibicao || usuario.nome,
        perfilSlug: usuario.perfil?.slug || null,
      }
    : null;

const repasse = (registro, { admin = false } = {}) => {
  if (!registro) return null;
  return {
    id: registro.id,
    status: registro.status,
    valorCentavos: n(registro.valor_centavos),
    disponivelEm: registro.disponivel_em,
    pagoEm: registro.pago_em,
    ...(admin
      ? {
          chavePix: registro.chave_pix,
          chavePixTipo: registro.chave_pix_tipo,
          comprovante: registro.comprovante,
          observacao: registro.observacao,
          pagoPor: registro.pago_por,
        }
      : {}),
  };
};

function pedido(registro, { visao = 'comprador' } = {}) {
  const verValores = visao !== 'comprador';
  const admin = visao === 'admin';

  return {
    id: registro.id,
    codigo: registro.codigo,
    status: registro.status,
    titulo: registro.titulo,
    quantidade: registro.quantidade,
    precoUnitarioCentavos: n(registro.preco_unitario_centavos),
    valorTotalCentavos: n(registro.valor_total_centavos),
    ...(verValores
      ? {
          comissaoPercentual: n(registro.comissao_percentual),
          comissaoCentavos: n(registro.comissao_centavos),
          valorVendedorCentavos: n(registro.valor_vendedor_centavos),
        }
      : {}),
    anuncio: registro.anuncio
      ? { id: registro.anuncio.id, slug: registro.anuncio.slug, codigo: registro.anuncio.codigo, capa: capa(registro.anuncio) }
      : { id: registro.anuncio_id },
    comprador: pessoa(registro.comprador),
    vendedor: pessoa(registro.vendedor),
    pagamento: {
      status: registro.mp_status,
      detalhe: registro.mp_status_detalhe,
      metodo: registro.mp_metodo,
      ...(admin ? { id: registro.mp_pagamento_id, preferenciaId: registro.mp_preferencia_id } : {}),
    },
    /* o link só vale enquanto a reserva vale — e só para quem vai pagar */
    checkoutUrl:
      visao === 'comprador' && registro.status === 'aguardando_pagamento' ? registro.checkout_url : undefined,
    reservadoAte: registro.reservado_ate,
    pagoEm: registro.pago_em,
    liberacaoAutomaticaEm: registro.liberacao_automatica_em,
    entregueEm: registro.entregue_em,
    entregaConfirmadaPor: registro.entrega_confirmada_por,
    disputa: registro.disputa_aberta_em ? { abertaEm: registro.disputa_aberta_em, motivo: registro.disputa_motivo } : null,
    canceladoEm: registro.cancelado_em,
    reembolsadoEm: registro.reembolsado_em,
    repasse: visao === 'comprador' ? undefined : repasse(registro.repasse, { admin }),
    historico: registro.historico
      ? registro.historico.map((h) => ({
          de: h.status_anterior,
          para: h.status_novo,
          motivo: h.motivo,
          por: h.ator_papel,
          em: h.criado_em,
        }))
      : undefined,
    criadoEm: registro.criado_em,
  };
}

const lista = (registros = [], opcoes) => registros.map((registro) => pedido(registro, opcoes));

/** linha do extrato do vendedor */
const itemExtrato = (registro) => ({
  ...repasse(registro),
  pedido: registro.pedido
    ? {
        id: registro.pedido.id,
        codigo: registro.pedido.codigo,
        titulo: registro.pedido.titulo,
        quantidade: registro.pedido.quantidade,
        status: registro.pedido.status,
        valorTotalCentavos: n(registro.pedido.valor_total_centavos),
        comissaoCentavos: n(registro.pedido.comissao_centavos),
        pagoEm: registro.pedido.pago_em,
        entregueEm: registro.pedido.entregue_em,
      }
    : null,
});

/** linha da fila de repasses da Admin — com o destino do PIX */
const itemRepasseAdmin = (registro) => {
  const perfil = registro.vendedor?.perfil;
  return {
    ...itemExtrato(registro),
    ...repasse(registro, { admin: true }),
    vendedor: registro.vendedor
      ? {
          id: registro.vendedor.id,
          nome: perfil?.nome_exibicao || registro.vendedor.nome,
          email: registro.vendedor.email,
          chavePix: perfil?.chave_pix || null,
          chavePixTipo: perfil?.chave_pix_tipo || null,
        }
      : null,
  };
};

const chavePix = (perfil) => ({ chavePix: perfil.chave_pix, chavePixTipo: perfil.chave_pix_tipo });

module.exports = { pedido, lista, itemExtrato, itemRepasseAdmin, chavePix };
