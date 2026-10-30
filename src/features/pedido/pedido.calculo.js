'use strict';

/**
 * A conta da comissão — num lugar só, em inteiros.
 *
 *   comissão          = total × percentual   (arredondada ao centavo)
 *   valor do vendedor = total − comissão
 *
 * O vendedor recebe o RESTO, não "total × (1 − percentual)" arredondado à
 * parte: dois arredondamentos independentes podem somar um centavo a mais ou
 * a menos que o total, e aí o ledger não fecha com o extrato do Mercado Pago.
 *
 * A taxa do Mercado Pago não entra aqui: é custo da plataforma (decisão da
 * cliente), e o vendedor recebe sobre o valor bruto da peça.
 */

/** percentual em centésimos (10.5% → 1050) para não multiplicar por float */
const emCentesimos = (percentual) => Math.round(Number(percentual) * 100);

function calcular({ precoUnitarioCentavos, quantidade, percentual }) {
  const total = Number(precoUnitarioCentavos) * Number(quantidade);
  const comissao = Math.round((total * emCentesimos(percentual)) / 10000);

  return {
    valorTotalCentavos: total,
    comissaoPercentual: emCentesimos(percentual) / 100,
    comissaoCentavos: comissao,
    valorVendedorCentavos: total - comissao,
  };
}

module.exports = { calcular };
