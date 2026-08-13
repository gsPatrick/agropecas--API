'use strict';

const bcrypt = require('bcryptjs');
const config = require('../../config');

/**
 * Hash de senha. Isolado num provider porque o algoritmo muda com o tempo:
 * quando bcrypt for substituído, só este arquivo é reescrito.
 *
 * `precisaRehash` permite migrar custo (ou algoritmo) no próximo login do
 * usuário, sem pedir que ninguém troque de senha.
 */

const gerarHash = (senha) => bcrypt.hash(senha, config.seguranca.bcryptRounds);

const conferir = (senha, hash) => {
  if (!senha || !hash) return Promise.resolve(false);
  return bcrypt.compare(senha, hash);
};

const precisaRehash = (hash) => {
  if (!hash) return true;
  const rounds = Number(String(hash).split('$')[2]);
  return Number.isNaN(rounds) || rounds < config.seguranca.bcryptRounds;
};

/**
 * Gasta o mesmo tempo de um `conferir` real, sem ter hash para comparar.
 *
 * Existe por causa de um vazamento sutil: quando o e-mail não está cadastrado
 * não há bcrypt para rodar, a resposta volta em ~3ms em vez de ~120ms, e essa
 * diferença sozinha revela quem tem conta na plataforma — mesmo com a mensagem
 * de erro idêntica.
 */
const HASH_DESCARTAVEL = bcrypt.hashSync('senha-descartavel-para-igualar-o-tempo', config.seguranca.bcryptRounds);

const conferirFalso = (senha) => bcrypt.compare(String(senha || ''), HASH_DESCARTAVEL).then(() => false);

module.exports = { gerarHash, conferir, precisaRehash, conferirFalso };
