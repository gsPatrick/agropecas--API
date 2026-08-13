'use strict';

const config = require('../config');
const silencioso = require('./adaptadores/silencioso');
const { EVENTOS, ENTRADA } = require('./eventos');
const { salas } = require('./salas');

/**
 * Tempo real do sistema.
 *
 * ```js
 * const tempoReal = require('../../tempo-real');
 * tempoReal.paraUsuario(id, tempoReal.EVENTOS.NOTIFICACAO_NOVA, dados);
 * ```
 *
 * **Emitir nunca pode quebrar uma requisição.** Se o WebSocket estiver fora,
 * a notificação já foi gravada no banco e aparece quando a pessoa abrir a
 * tela. Por isso todo `emit` é engolido em caso de erro: entrega em tempo real
 * é melhoria de experiência, não o registro do fato.
 */

let adaptador = silencioso;

async function iniciar(servidorHttp) {
  if (!config.tempoReal.ativo) {
    console.log('[tempo-real] desligado por configuração');
    return null;
  }

  adaptador = require('./adaptadores/socketio');
  return adaptador.iniciar(servidorHttp);
}

const seguro = (metodo) => (...args) => {
  try {
    return adaptador[metodo](...args);
  } catch (erro) {
    console.error(`[tempo-real] falha em ${metodo}:`, erro.message);
    return undefined;
  }
};

module.exports = {
  iniciar,
  paraUsuario: seguro('paraUsuario'),
  paraConversa: seguro('paraConversa'),
  paraSala: seguro('paraSala'),
  conectados: (id) => adaptador.conectados(id).catch(() => 0),
  encerrar: () => adaptador.encerrar(),
  motor: () => adaptador.nome,
  EVENTOS,
  ENTRADA,
  salas,
};
