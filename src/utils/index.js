'use strict';

/** Barril dos utilitários — `require('../../utils')` em qualquer feature. */

module.exports = {
  ...require('./erros'),
  ...require('./catch-async'),
  resposta: require('./resposta'),
  ...require('./texto'),
  ...require('./documento'),
  ...require('./hash'),
  ...require('./paginacao'),
  datas: require('./datas'),
  /* namespace e não spread: `distanciaKm` e `caixaDeRaio` só fazem sentido
     lidos como `geo.distanciaKm` — soltos no barril viram nomes ambíguos */
  geo: require('./geo'),
};
