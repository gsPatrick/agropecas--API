'use strict';

const registro = require('../registro');

/**
 * Executor sem fila — o padrão quando não há Redis.
 *
 * Roda o trabalho na hora, mas **fora do caminho da resposta**: a promessa não
 * é aguardada, e a falha só vira log. Assim o comportamento se parece com o da
 * fila (quem enfileira não espera, e falha de job não derruba a requisição),
 * mesmo sem infraestrutura.
 *
 * O que ele não tem: retentativa com espera, persistência entre reinícios e
 * agendamento. Por isso produção sem Redis é avisada no boot.
 */

module.exports = {
  nome: 'imediato',

  async enfileirar(nomeDoTrabalho, dados, opcoes = {}) {
    const trabalho = registro.obter(nomeDoTrabalho);

    if (!trabalho) {
      console.error(`[filas] trabalho desconhecido: ${nomeDoTrabalho}`);
      return { id: null, executado: false };
    }

    const rodar = () =>
      Promise.resolve(trabalho.executor(dados, { tentativa: 1, modo: 'imediato' })).catch((erro) =>
        console.error(`[filas] ${nomeDoTrabalho} falhou:`, erro.message)
      );

    /* respeita atraso pedido, mas sem segurar quem chamou */
    if (opcoes.atrasoMs) setTimeout(rodar, opcoes.atrasoMs).unref();
    else setImmediate(rodar);

    return { id: `imediato:${nomeDoTrabalho}`, executado: true };
  },

  async agendar() {
    /* repetição precisa de estado entre reinícios: sem Redis não há onde
       guardar, e fingir que agendou seria pior que recusar */
    console.warn('[filas] agendamento periódico exige Redis — ignorado');
    return null;
  },

  async estatisticas() {
    return { modo: 'imediato', aguardando: 0, ativos: 0, concluidos: 0, falhados: 0 };
  },

  async encerrar() {},
};
