'use strict';

/**
 * Módulo RBAC — base do sistema, não é feature.
 *
 *   recursos.js     o que existe no sistema (recursos × ações × escopos)
 *   permissoes.js   catálogo derivado dos recursos
 *   papeis.js       papéis padrão e o que cada um recebe
 *   autorizacao.js  motor: pode() · exigir() · filtroDeEscopo()
 *   sincronizar.js  espelha o catálogo no banco, de forma idempotente
 *
 * Uso típico num service:
 *
 *   const { exigir, filtroDeEscopo } = require('../../rbac');
 *
 *   exigir(ctx, 'anuncio.editar', { donoId: anuncio.usuario_id });
 *   const where = filtroDeEscopo(ctx, 'anuncio.ler');   // {} ou { usuario_id }
 */

const { RECURSOS } = require('./recursos');
const { PERMISSOES, CHAVES, CORINGA, doRecurso, propriasDoRecurso } = require('./permissoes');
const { PAPEIS, validar } = require('./papeis');
const autorizacao = require('./autorizacao');
const { sincronizar } = require('./sincronizar');

module.exports = {
  RECURSOS,
  PERMISSOES,
  CHAVES,
  CORINGA,
  PAPEIS,
  doRecurso,
  propriasDoRecurso,
  validar,
  sincronizar,
  ...autorizacao,
};
