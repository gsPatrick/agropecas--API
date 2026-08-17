'use strict';

const Redis = require('ioredis');
const config = require('../../config');

/**
 * Conexão Redis — opcional por decisão de arquitetura.
 *
 * Sem `REDIS_URL`, tudo continua funcionando: cache cai para memória e fila
 * executa na hora. Isso mantém o `git clone && npm run dev` de um dia sem
 * infraestrutura, e deixa o Redis ser uma escolha de produção em vez de um
 * pré-requisito para escrever a primeira linha.
 *
 * O resto do sistema não importa `ioredis`: fala com `cache` e `filas`. Trocar
 * o cliente é reescrever este arquivo.
 */

let cliente = null;
let avisou = false;

function conectar() {
  if (cliente) return cliente;
  if (!config.redis.url) return null;

  cliente = new Redis(config.redis.url, {
    maxRetriesPerRequest: null, // exigido pelo BullMQ
    enableReadyCheck: true,
    retryStrategy: (tentativa) => Math.min(tentativa * 200, 5000),
    lazyConnect: false,
  });

  cliente.on('error', (erro) => {
    /* uma linha por falha inundaria o log durante uma queda; a primeira basta
       para o alerta, e o `retryStrategy` cuida da volta */
    if (!avisou) {
      console.error('[redis] indisponível:', erro.message);
      avisou = true;
    }
  });

  cliente.on('ready', () => {
    avisou = false;
    console.log('[redis] conectado');
  });

  return cliente;
}

/**
 * Conexão dedicada — BullMQ exige uma por fila/worker, não compartilhável.
 *
 * Sem handler de erro, um evento `error` sem ouvinte derruba o processo
 * inteiro (comportamento padrão de `EventEmitter` do Node) — com REDIS_URL
 * configurado mas o servidor fora do ar, era exatamente isso que ia
 * acontecer na primeira fila/worker criado por `bullmq.js`. O aviso
 * "missing 'error' handler on this Redis client" no log era o Node avisando
 * disso antes de acontecer.
 */
const novaConexao = () => {
  if (!config.redis.url) return null;

  const conexao = new Redis(config.redis.url, { maxRetriesPerRequest: null });
  conexao.on('error', () => {}); /* o cliente principal (`conectar()`) já loga o alerta */
  return conexao;
};

const disponivel = () => Boolean(cliente && cliente.status === 'ready');

const encerrar = async () => {
  if (!cliente) return;
  await cliente.quit().catch(() => cliente.disconnect());
  cliente = null;
};

module.exports = { conectar, novaConexao, disponivel, encerrar, get cliente() { return cliente; } };
