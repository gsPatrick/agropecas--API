'use strict';

const leitura = require('./configuracao.leitura.service');
const { TIPO, PUBLICAS, TTL_SEGUNDOS } = require('./configuracao.constants');

/**
 * API INTERNA do módulo — a parte mais importante daqui.
 *
 * As outras features não importam service nenhum desta pasta; importam isto:
 *
 * ```js
 * const configuracao = require('../configuracao');
 *
 * const dias     = await configuracao.obter('anuncio.dias_validade', 60);
 * const moderar  = await configuracao.booleano('anuncio.moderacao_previa', false);
 * const { fotos, chat } = await configuracao.obterVarias({
 *   fotos: ['anuncio.max_fotos', 8],
 *   chat:  ['chat.ativo', true],
 * });
 * ```
 *
 * Contrato, em três linhas:
 *
 * 1. **Nunca lança.** Chave ausente, banco fora, cache corrompido — devolve o
 *    padrão e registra aviso. Configuração faltando não derruba funcionalidade.
 * 2. **Devolve já tipado.** Número volta número, booleano volta booleano.
 *    Se você escreveu `Number(await configuracao.obter(...))`, algo está errado
 *    aqui e é para reportar, não para contornar.
 * 3. **O padrão é obrigatório na prática.** Quem chama sabe o valor seguro do
 *    seu caso; o módulo não tem como saber.
 *
 * Não confundir com `src/config`: aquilo é ambiente e infraestrutura (porta,
 * segredo, string de conexão), lido do `.env` e imutável em runtime. Isto é
 * ajuste de produto, editável pela Admin na tela e válido em segundos.
 */

/** leitura tipada com padrão — o método que 90% das features vão usar */
const obter = leitura.obter;

/** leitura em lote, uma consulta só */
const obterVarias = leitura.obterVarias;

/* atalhos que deixam a intenção explícita na chamada e garantem o tipo mesmo
   se alguém trocar o `tipo` da chave no banco por engano */
const numero = async (chave, padrao = null) => {
  const valor = await obter(chave, padrao);
  const convertido = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(convertido) ? convertido : padrao;
};

const booleano = async (chave, padrao = false) => {
  const valor = await obter(chave, padrao);
  return typeof valor === 'boolean' ? valor : Boolean(valor);
};

const texto = async (chave, padrao = '') => {
  const valor = await obter(chave, padrao);
  return valor === null || valor === undefined ? padrao : String(valor);
};

const lista = async (chave, padrao = []) => {
  const valor = await obter(chave, padrao);
  return Array.isArray(valor) ? valor : padrao;
};

module.exports = {
  obter,
  obterVarias,
  numero,
  booleano,
  texto,
  lista,

  /** enche o cache no boot, para que a primeira requisição não pague a consulta */
  preaquecer: leitura.preaquecer,
  /** derruba o cache em todas as instâncias — a escrita já faz isto sozinha */
  invalidar: leitura.invalidar,

  TIPO,
  PUBLICAS,
  TTL_SEGUNDOS,
  rotas: require('./configuracao.routes'),
};
