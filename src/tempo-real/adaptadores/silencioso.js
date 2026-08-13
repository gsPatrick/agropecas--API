'use strict';

/**
 * Adaptador nulo — usado quando o tempo real está desligado (`WS_ATIVO=false`)
 * ou em teste.
 *
 * Existe para que nenhuma feature precise perguntar "o WebSocket está ligado?".
 * Emitir para o vazio é operação válida: a notificação continua sendo gravada
 * no banco, e o usuário a vê ao abrir a tela. O tempo real é entrega
 * complementar, nunca a única.
 */
module.exports = {
  nome: 'silencioso',
  async iniciar() { return null; },
  paraUsuario() {},
  paraConversa() {},
  paraSala() {},
  async conectados() { return 0; },
  async encerrar() {},
};
