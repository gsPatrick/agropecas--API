'use strict';

const { Queue, Worker } = require('bullmq');
const config = require('../../config');
const redis = require('../../providers/redis');
const definicoes = require('../definicoes');
const registro = require('../registro');

/**
 * Adaptador BullMQ — o único arquivo do projeto que conhece a biblioteca de
 * filas. Features falam com `src/filas`, nunca com isto.
 *
 * Uma `Queue` por natureza de trabalho; o worker é iniciado separadamente
 * (`npm run worker`), não junto da API. Rodar worker dentro do processo web faz
 * job pesado competir por CPU com quem está esperando resposta na tela.
 */

const filas = new Map();
const trabalhadores = new Map();

/* conexões que ESTE módulo criou. O BullMQ não fecha conexão que recebeu de
   fora — ele assume que quem passou é quem gerencia. Sem guardar aqui, o
   processo fica vivo depois do `close()` esperando um socket que ninguém
   fecha. */
const conexoes = new Set();

function conexao() {
  const nova = redis.novaConexao();
  if (nova) conexoes.add(nova);
  return nova;
}

const prefixo = () => `${config.redis.prefixo}:${config.app.env}:fila`;

/**
 * O BullMQ recusa `:` no id do job — o caractere é separador interno das
 * chaves dele no Redis. Como nossas chaves naturais usam `:` (`email:abc`),
 * a normalização acontece aqui, e quem chama não precisa saber disso.
 */
const idSeguro = (valor) => String(valor).replace(/:/g, '-').slice(0, 200);

function obterFila(nome) {
  if (filas.has(nome)) return filas.get(nome);

  const fila = new Queue(nome, {
    connection: conexao(),
    prefix: prefixo(),
    defaultJobOptions: {
      attempts: config.filas.tentativas,
      backoff: { type: 'exponential', delay: config.filas.esperaInicialMs },
      /* limpar automaticamente: sem isto o Redis vira depósito de histórico e
         a memória acaba num dia de pico */
      removeOnComplete: { count: config.filas.manterConcluidos },
      removeOnFail: { count: config.filas.manterFalhados },
    },
  });

  filas.set(nome, fila);
  return fila;
}

module.exports = {
  nome: 'bullmq',

  async enfileirar(nomeDoTrabalho, dados, opcoes = {}) {
    const trabalho = registro.obter(nomeDoTrabalho);
    if (!trabalho) {
      console.error(`[filas] trabalho desconhecido: ${nomeDoTrabalho}`);
      return { id: null, executado: false };
    }

    const fila = obterFila(trabalho.fila || definicoes.FILAS.MANUTENCAO.nome);
    const definicao = definicoes.porNome(trabalho.fila);

    const job = await fila.add(nomeDoTrabalho, dados, {
      delay: opcoes.atrasoMs || undefined,
      attempts: opcoes.tentativas || definicao?.tentativas,
      priority: opcoes.prioridade,
      /* `jobId` idêntico é ignorado pelo BullMQ: é como um clique duplo em
         "reenviar código" não vira dois e-mails */
      jobId: opcoes.chaveUnica ? idSeguro(opcoes.chaveUnica) : undefined,
    });

    return { id: job.id, executado: false };
  },

  /** trabalho periódico — expiração de anúncio, limpeza de sessão, LGPD */
  async agendar(nomeDoTrabalho, dados, { cron, fusoHorario = 'America/Cuiaba' }) {
    const trabalho = registro.obter(nomeDoTrabalho);
    if (!trabalho) throw new Error(`Fila: trabalho desconhecido "${nomeDoTrabalho}".`);

    const fila = obterFila(trabalho.fila || definicoes.FILAS.MANUTENCAO.nome);

    return fila.add(nomeDoTrabalho, dados, {
      repeat: { pattern: cron, tz: fusoHorario },
      jobId: idSeguro(`periodico-${nomeDoTrabalho}`),
    });
  },

  /** sobe um worker por fila — chamado só pelo processo de worker */
  iniciarTrabalhadores({ apenas } = {}) {
    const alvo = apenas
      ? definicoes.LISTA.filter((fila) => apenas.includes(fila.nome))
      : definicoes.LISTA;

    alvo.forEach((definicao) => {
      if (trabalhadores.has(definicao.nome)) return;

      const worker = new Worker(
        definicao.nome,
        async (job) => {
          const trabalho = registro.obter(job.name);
          if (!trabalho) throw new Error(`Trabalho não registrado: ${job.name}`);

          return trabalho.executor(job.data, {
            tentativa: job.attemptsMade + 1,
            jobId: job.id,
            modo: 'fila',
          });
        },
        {
          connection: conexao(),
          prefix: prefixo(),
          concurrency: definicao.concorrencia || config.filas.concorrencia,
        }
      );

      worker.on('failed', (job, erro) => {
        console.error(`[fila:${definicao.nome}] ${job?.name} falhou (tentativa ${job?.attemptsMade}):`, erro.message);
      });

      worker.on('completed', (job) => {
        if (config.app.env !== 'production') {
          console.log(`[fila:${definicao.nome}] ${job.name} concluído`);
        }
      });

      trabalhadores.set(definicao.nome, worker);
      console.log(`[fila:${definicao.nome}] worker ativo (concorrência ${definicao.concorrencia})`);
    });

    return trabalhadores.size;
  },

  async estatisticas() {
    const saida = { modo: 'bullmq' };

    for (const definicao of definicoes.LISTA) {
      const fila = obterFila(definicao.nome);
      const contagem = await fila.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed');
      saida[definicao.nome] = contagem;
    }
    return saida;
  },

  async encerrar() {
    await Promise.all([...trabalhadores.values()].map((w) => w.close().catch(() => null)));
    await Promise.all([...filas.values()].map((f) => f.close().catch(() => null)));
    await Promise.all(
      [...conexoes].map((c) => c.quit().catch(() => c.disconnect()))
    );

    trabalhadores.clear();
    filas.clear();
    conexoes.clear();
  },
};
