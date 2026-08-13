'use strict';

const { base } = require('../../cache/chaves');

/**
 * Chaves de cache da feature.
 *
 * Moram aqui, e não em `src/cache/chaves.js`, porque aquele arquivo é
 * compartilhado por todos os módulos em construção — cada feature acrescentar
 * uma linha lá viraria conflito garantido. O prefixo continua sendo o comum,
 * então a invalidação por domínio do sistema alcança estas chaves também.
 */

const chaves = {
  /** contador de não lidas — lido em TODA navegação, por isso vive em cache */
  contador: (usuarioId) => `${base()}:notificacao:contador:${usuarioId}`,

  /** preferências do usuário, consultadas a cada notificação criada */
  preferencias: (usuarioId) => `${base()}:notificacao:preferencias:${usuarioId}`,

  /** templates por tipo+canal — leitura constante, escrita rara (só o Admin) */
  template: (tipo, canal) => `${base()}:notificacao:template:${tipo}:${canal}`,

  /** tudo da feature, para invalidação ampla */
  dominio: () => `${base()}:notificacao:*`,

  templates: () => `${base()}:notificacao:template:*`,
};

module.exports = { chaves };
