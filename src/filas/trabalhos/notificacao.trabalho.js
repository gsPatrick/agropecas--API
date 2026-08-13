'use strict';

const { registrar } = require('../registro');
const { FILAS } = require('../definicoes');

/**
 * Trabalhos de notificação.
 *
 * Os services são carregados DENTRO do executor, não no topo do arquivo:
 * `src/filas/index.js` importa todos os trabalhos, e importar a feature aqui
 * em cima puxaria models, cache e tempo real para dentro do boot das filas —
 * um ciclo de require esperando acontecer.
 */

/**
 * `notificacao.criar` — o contrato que todos os módulos usam.
 *
 * ```js
 * await filas.enfileirar('notificacao.criar', {
 *   usuarioId, tipo, titulo, mensagem, dados, entidade, entidadeId,
 *   canais: ['sistema'],
 * });
 * ```
 *
 * Notificar é efeito colateral: não pode entrar no tempo de resposta de quem
 * mandou a mensagem, nem derrubar a operação que a originou. Preferência
 * desligada e destinatário indisponível não são falha — o service devolve
 * `ignorados` e o job termina em sucesso, porque retentar não mudaria nada.
 */
const CRIAR = registrar(
  'notificacao.criar',
  async (dados) => {
    const criacao = require('../../features/notificacao/notificacao.criacao.service');
    return criacao.criar(dados);
  },
  { fila: FILAS.NOTIFICACAO.nome }
);

/**
 * `notificacao.enviarEmMassa` — comunicado do Admin, um bloco por execução.
 *
 * O job **se reenfileira** com o cursor do próximo bloco em vez de varrer a
 * base inteira numa execução só. Motivos: um job longo segura um worker por
 * minutos e trava o resto da fila; uma falha no meio perderia o progresso; e a
 * memória do processo não aguenta a base inteira carregada.
 *
 * O bloco é idempotente (descarta quem já tem linha do lote), então a
 * retentativa automática da fila não gera aviso duplicado.
 */
const ENVIAR_EM_MASSA = registrar(
  'notificacao.enviarEmMassa',
  async (dados) => {
    const filas = require('../index');
    const massa = require('../../features/notificacao/notificacao.massa.service');

    const { criadas, proximoCursor, fim } = await massa.processarBloco(dados);

    if (!fim && proximoCursor) {
      await filas.enfileirar(
        'notificacao.enviarEmMassa',
        { ...dados, cursor: proximoCursor },
        /* a chave única é do BLOCO: se o job for retentado depois de já ter
           enfileirado o próximo, não nasce um segundo ramo percorrendo a mesma
           faixa de usuários */
        { chaveUnica: `comunicado:${dados.loteId}:${proximoCursor}` }
      );
    }

    return { loteId: dados.loteId, criadas, proximoCursor, fim };
  },
  { fila: FILAS.NOTIFICACAO.nome }
);

module.exports = { CRIAR, ENVIAR_EM_MASSA };
