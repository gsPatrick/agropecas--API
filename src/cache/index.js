'use strict';

const config = require('../config');
const redis = require('../providers/redis');
const memoria = require('./adaptadores/memoria');
const adaptadorRedis = require('./adaptadores/redis');
const { chaves, assinatura } = require('./chaves');

/**
 * Cache do sistema.
 *
 * Escolhe o adaptador **por chamada**, não no boot: se o Redis cair no meio do
 * expediente, a aplicação continua servindo com cache local em vez de
 * derrubar requisição. Cache é otimização — nunca pode ser motivo de queda.
 *
 * ```js
 * const cache = require('../../cache');
 *
 * const categorias = await cache.lembrar(
 *   cache.chaves.categorias(),
 *   () => Categoria.findAll(),
 *   { ttl: 3600 }
 * );
 * ```
 */

const adaptador = () => (redis.disponivel() ? adaptadorRedis : memoria);

const ligado = () => config.cache.ativo;

async function obter(chave) {
  if (!ligado()) return undefined;
  try {
    return await adaptador().obter(chave);
  } catch (erro) {
    console.error('[cache] falha ao ler', chave, erro.message);
    return undefined;
  }
}

async function gravar(chave, valor, { ttl = config.cache.ttlPadraoSegundos } = {}) {
  if (!ligado() || valor === undefined) return false;
  try {
    await adaptador().gravar(chave, valor, ttl);
    return true;
  } catch (erro) {
    console.error('[cache] falha ao gravar', chave, erro.message);
    return false;
  }
}

async function remover(...chavesAlvo) {
  const lista = chavesAlvo.flat().filter(Boolean);
  if (!lista.length) return;

  try {
    await adaptador().remover(lista);
  } catch (erro) {
    console.error('[cache] falha ao remover', erro.message);
  }
}

/** invalidação em massa: `invalidar(cache.chaves.dominio('anuncios'))` */
async function invalidar(padrao) {
  try {
    return await adaptador().removerPorPadrao(padrao);
  } catch (erro) {
    console.error('[cache] falha ao invalidar', padrao, erro.message);
    return 0;
  }
}

/**
 * O padrão que as features usam: devolve do cache ou calcula e guarda.
 *
 * Cachear `null`/`undefined` é opcional e desligado por padrão. Guardar
 * "não achei" protege contra martelar o banco com consulta de item
 * inexistente, mas atrasa o aparecimento de um item recém-criado — por isso a
 * decisão é de quem chama.
 */
async function lembrar(chave, produzir, { ttl = config.cache.ttlPadraoSegundos, cachearVazio = false } = {}) {
  const guardado = await obter(chave);
  if (guardado !== undefined) return guardado;

  const valor = await produzir();
  if (valor !== undefined && (valor !== null || cachearVazio)) {
    await gravar(chave, valor, { ttl });
  }
  return valor;
}

/** contador com janela — base do rate limit distribuído */
async function incrementar(chave, { quanto = 1, ttl } = {}) {
  try {
    return await adaptador().incrementar(chave, quanto, ttl);
  } catch (erro) {
    console.error('[cache] falha ao incrementar', chave, erro.message);
    return 0;
  }
}

const ttl = (chave) => adaptador().ttl(chave).catch(() => -1);

const motor = () => adaptador().nome;

module.exports = {
  obter,
  gravar,
  remover,
  invalidar,
  lembrar,
  incrementar,
  ttl,
  motor,
  chaves,
  assinatura,
};
