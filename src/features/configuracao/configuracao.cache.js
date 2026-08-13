'use strict';

const { base } = require('../../cache/chaves');
const { chaves: chavesComuns } = require('../../cache/chaves');

/**
 * Chaves de cache da feature.
 *
 * Uma chave só guarda o mapa INTEIRO de configurações, não uma chave por
 * configuração. São poucas dezenas de linhas: buscar todas em uma consulta e
 * servir o mapa da memória custa menos que gerenciar N chaves — e invalidar
 * passa a ser uma operação atômica em vez de N remoções que podem falhar pela
 * metade e deixar o cache incoerente.
 */
const chaves = {
  /** mapa completo `{ chave: { valor, tipo, ... } }` — reusa a chave comum */
  mapa: () => chavesComuns.configuracoes(),

  /** namespace da feature, para invalidação em massa */
  dominio: () => `${base()}:configuracoes*`,
};

module.exports = { chaves };
