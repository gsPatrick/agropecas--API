'use strict';

/**
 * Constantes da feature.
 *
 * Ficam fora dos services para que nenhum número mágico precise ser caçado em
 * três arquivos quando o produto mudar de ideia.
 */

/** teto da checagem em lote — ver `favorito.consulta.service.js` */
const MAXIMO_IDS_POR_LOTE = 120;

/** anotação pessoal do usuário sobre o item salvo ("perguntar o frete") */
const ANOTACAO_MAXIMA = 255;

/**
 * Colunas do anúncio que a lista de favoritos precisa.
 *
 * Explícito porque `anuncios` é tabela larga: `descricao` e `busca_texto` são
 * TEXT e nenhum card da tela usa nenhum dos dois. Trazê-los multiplicaria o
 * tráfego da consulta mais aberta do módulo sem pintar um pixel.
 */
const COLUNAS_ANUNCIO = [
  'id',
  'codigo',
  'slug',
  'titulo',
  'tipo',
  'status',
  'preco_centavos',
  'preco_a_combinar',
  'moeda',
  'condicao',
  'municipio_id',
  'uf',
  'usuario_id',
  'total_favoritos',
  'publicado_em',
];

module.exports = { MAXIMO_IDS_POR_LOTE, ANOTACAO_MAXIMA, COLUNAS_ANUNCIO };
