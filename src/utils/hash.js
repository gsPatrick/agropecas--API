'use strict';

const crypto = require('crypto');
const config = require('../config');

/**
 * Hashes de uso geral. Senha NÃO passa por aqui — senha usa bcrypt, no
 * provider dedicado, porque precisa de custo alto e sal por registro.
 *
 * `hashIp` é pseudonimização (LGPD): dá para correlacionar sessões e detectar
 * abuso sem manter endereço identificável no banco. Trocar o sal invalida a
 * correlação de logs antigos — o que é intencional, não um efeito colateral.
 */

const sha256 = (valor) => crypto.createHash('sha256').update(String(valor)).digest('hex');

const hashIp = (ip) => (ip ? sha256(`${ip}:${config.seguranca.ipSalt}`) : null);

/** hash de token/código guardado no banco: vazamento da tabela não vira acesso */
const hashToken = (token) => sha256(token);

/** token opaco para refresh e links de e-mail */
const gerarToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

/** código numérico do OTP — `randomInt` é criptográfico, `Math.random` não é */
const gerarCodigoNumerico = (digitos = 6) => {
  const min = 10 ** (digitos - 1);
  const max = 10 ** digitos - 1;
  return String(crypto.randomInt(min, max + 1));
};

/**
 * Comparação em tempo constante: comparar hash com `===` vaza informação pelo
 * tempo de resposta.
 */
const compararSeguro = (a = '', b = '') => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

module.exports = { sha256, hashIp, hashToken, gerarToken, gerarCodigoNumerico, compararSeguro };
