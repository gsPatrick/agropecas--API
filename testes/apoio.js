'use strict';

const RAIZ = require('path').resolve(__dirname, '..');
const cache = require(RAIZ + '/src/cache');
const redis = require(RAIZ + '/src/providers/redis');
const filas = require(RAIZ + '/src/filas');

/**
 * Apoio comum às suítes.
 *
 * O rate limit passou a ser compartilhado via Redis — correto em produção, mas
 * faz uma suíte esgotar o limite da seguinte quando rodam em sequência. Zerar
 * o contador no início isola cada uma.
 */
async function limparLimites() {
  redis.conectar();
  await new Promise((resolver) => setTimeout(resolver, 400));
  await cache.invalidar(cache.chaves.dominio('limite'));
}

/**
 * Fecha tudo que segura o event loop.
 *
 * As filas abrem conexão própria com o Redis (o BullMQ exige uma por fila).
 * Fechar só o cliente compartilhado deixava o processo vivo depois do último
 * teste — e um teste que não termina parece um teste travado.
 */
async function encerrarInfra() {
  await filas.encerrar();
  await redis.encerrar();
}

module.exports = { limparLimites, encerrarInfra, RAIZ };
