'use strict';

const { base } = require('../../cache/chaves');

/**
 * Chaves de cache da feature — moram aqui, e não em `cache/chaves.js`, para
 * que dois módulos escritos em paralelo não disputem o mesmo arquivo
 * (PADRÃO_MODULO §7).
 *
 * Só o painel de contadores é cacheado. A fila NÃO é: ela muda a cada denúncia
 * e a cada aprovação, e servir uma fila velha faria dois moderadores pegarem o
 * mesmo caso — ou pior, um caso que já foi resolvido.
 */
const chaves = {
  /** contadores do painel de pendências */
  painel: () => `${base()}:moderacao:painel`,

  /** namespace da feature, para invalidação em massa após qualquer ação */
  dominio: () => `${base()}:moderacao*`,
};

module.exports = { chaves };
