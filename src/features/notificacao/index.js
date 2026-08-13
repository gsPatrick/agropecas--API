'use strict';

/**
 * Porta de entrada do módulo de notificação para os OUTROS módulos.
 *
 * O contrato público é este e só este:
 *
 * ```js
 * // caminho normal — notificar não entra no tempo de resposta de ninguém
 * const filas = require('../../filas');
 * await filas.enfileirar('notificacao.criar', {
 *   usuarioId, tipo, titulo, mensagem, dados, entidade, entidadeId,
 *   canais: ['sistema'],
 * });
 *
 * // chamada direta — quando já se está dentro de um job, ou quando quem
 * // chama precisa do registro criado de volta
 * const notificacaoService = require('../notificacao');
 * await notificacaoService.criar({ ...os mesmos campos });
 * ```
 *
 * Este barril existe para que ninguém precise saber em qual `.service.js` cada
 * função mora: o dia em que a criação for dividida em dois arquivos, nenhum
 * módulo consumidor muda.
 */

const criacao = require('./notificacao.criacao.service');
const contador = require('./notificacao.contador.service');
const preferencia = require('./notificacao.preferencia.service');
const massa = require('./notificacao.massa.service');
const template = require('./notificacao.template.service');

module.exports = {
  criar: criacao.criar,

  /** contador de não lidas, já em cache — para telas que montam o menu */
  naoLidas: contador.atual,

  /** consulta de preferência, para quem precisa decidir antes de disparar */
  permite: preferencia.permite,

  /** comunicado do Admin; exige a capacidade `notificacao.enviar` */
  enviarEmMassa: massa.agendar,

  /** substituição de `{{chave}}` — reaproveitável por quem monta texto */
  renderizar: template.renderizar,

  routes: () => require('./notificacao.routes'),
};
