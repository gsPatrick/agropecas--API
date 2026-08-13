'use strict';

const { registrar } = require('../registro');
const { FILAS } = require('../definicoes');

/**
 * Trabalhos de mídia.
 *
 * Os models e os services são carregados DENTRO do executor, e não no topo:
 * `src/filas/index.js` carrega este arquivo no boot da API, e puxar Sequelize
 * e sharp junto atrasaria o start de um processo que talvez nunca execute um
 * job (a API publica, o worker consome).
 *
 * A fila é a `MIDIA`, com concorrência 3: processamento de imagem é limitado
 * por CPU, e concorrência maior que o número de núcleos só troca throughput
 * por troca de contexto.
 */

/**
 * Gera as variantes (thumb, média, grande em WebP) de um upload.
 *
 * Idempotente por construção: cada rótulo existe no máximo uma vez por
 * original e o que já está lá é pulado. É o que torna seguro retentar, e o que
 * permite à faxina reenfileirar qualquer arquivo em dúvida sem checagem prévia.
 */
const PROCESSAR = registrar(
  'midia.processar',
  async ({ arquivoId }) => {
    if (!arquivoId) throw new Error('midia.processar exige arquivoId');

    const processamento = require('../../features/midia/midia.processamento.service');
    return processamento.gerarVariantes(arquivoId);
  },
  { fila: FILAS.MIDIA.nome }
);

/**
 * Faxina periódica: marca upload que ninguém vinculou, apaga o que já passou
 * da carência e reenfileira o que ficou sem variante.
 *
 * As três coisas juntas porque compartilham a mesma janela de madrugada e a
 * mesma tabela; separá-las em três jobs multiplicaria o agendamento sem
 * ganhar nada — nenhuma delas é longa o bastante para atrapalhar a outra.
 */
const LIMPAR_ORFAOS = registrar(
  'midia.limparOrfaos',
  async () => {
    const limpeza = require('../../features/midia/midia.limpeza.service');

    const marcados = await limpeza.marcarOrfaos();
    const descartados = await limpeza.descartarMarcados();
    const pendentes = await limpeza.reenfileirarPendentes();

    return { marcados, ...descartados, ...pendentes };
  },
  { fila: FILAS.MIDIA.nome }
);

module.exports = { PROCESSAR, LIMPAR_ORFAOS };
