'use strict';

/** Barril dos middlewares — importados por nome nas rotas de cada feature. */

const autenticar = require('./autenticar');
const autorizar = require('./autorizar');
const validar = require('./validar');

module.exports = {
  contexto: require('./contexto'),
  autenticar,
  autenticacaoOpcional: autenticar.opcional,
  exigirVerificado: autenticar.exigirVerificado,
  autorizar,
  somenteAdmin: autorizar.somenteAdmin,
  validar,
  validarQuery: validar.query,
  validarParams: validar.params,
  queryBruta: require('./query-bruta'),
  rateLimit: require('./rate-limit'),
  erro: require('./erro'),
};
