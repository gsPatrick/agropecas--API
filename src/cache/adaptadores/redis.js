'use strict';

const redis = require('../../providers/redis');

/**
 * Cache em Redis — compartilhado entre instâncias.
 *
 * Valor trafega como JSON: o cache guarda dado de leitura (listagem, contagem,
 * consulta de CEP), não objeto vivo do Sequelize. Guardar instância seria
 * convidar a chamar `.save()` num objeto que veio do cache.
 */

const serializar = (valor) => JSON.stringify({ v: valor });

const desserializar = (texto) => {
  if (texto === null || texto === undefined) return undefined;
  try {
    return JSON.parse(texto).v;
  } catch {
    /* valor corrompido é tratado como ausente: derrubar a requisição por causa
       de uma entrada de cache ruim seria trocar lentidão por indisponibilidade */
    return undefined;
  }
};

module.exports = {
  nome: 'redis',

  async obter(chave) {
    return desserializar(await redis.cliente.get(chave));
  },

  async gravar(chave, valor, ttlSegundos) {
    const texto = serializar(valor);
    if (ttlSegundos) await redis.cliente.set(chave, texto, 'EX', ttlSegundos);
    else await redis.cliente.set(chave, texto);
  },

  async remover(chaves) {
    if (chaves.length) await redis.cliente.del(...chaves);
  },

  /**
   * `SCAN` em vez de `KEYS`: `KEYS` percorre o keyspace inteiro travando o
   * Redis, o que em produção derruba todo mundo por causa de uma invalidação.
   */
  async removerPorPadrao(padrao) {
    let cursor = '0';
    let removidas = 0;

    do {
      const [proximo, chaves] = await redis.cliente.scan(cursor, 'MATCH', padrao, 'COUNT', 200);
      cursor = proximo;

      if (chaves.length) {
        await redis.cliente.del(...chaves);
        removidas += chaves.length;
      }
    } while (cursor !== '0');

    return removidas;
  },

  async incrementar(chave, quanto, ttlSegundos) {
    const novo = await redis.cliente.incrby(chave, quanto);

    /* só define o vencimento na primeira vez: renovar a cada incremento faria
       a janela de rate limit nunca fechar */
    if (novo === quanto && ttlSegundos) await redis.cliente.expire(chave, ttlSegundos);
    return novo;
  },

  async ttl(chave) {
    return redis.cliente.ttl(chave);
  },

  async limpar(prefixo) {
    return this.removerPorPadrao(`${prefixo}*`);
  },
};
