'use strict';

const db = require('../../models');
const cache = require('../../cache');
const { chaves } = require('./configuracao.cache');
const tipoService = require('./configuracao.tipo.service');
const { PUBLICAS, TTL_SEGUNDOS } = require('./configuracao.constants');

/**
 * Leitura das configurações.
 *
 * Estratégia: **uma consulta traz a tabela inteira** e o resultado vive em
 * cache como objeto simples. A alternativa (uma consulta por chave, com cache
 * por chave) seria uma ida ao banco por chave a cada requisição fria — e como
 * outras features leem três ou quatro chaves por requisição, isso multiplicaria
 * o custo sem nenhum ganho: a tabela toda cabe folgada em memória.
 *
 * O que vai para o cache é objeto puro, nunca instância do Sequelize: instância
 * não sobrevive à serialização do Redis e volta como um objeto meia-boca cheio
 * de `dataValues`.
 */

/** carrega tudo do banco no formato que o cache guarda */
async function carregar() {
  const linhas = await db.Configuracao.findAll({
    attributes: ['id', 'chave', 'valor', 'tipo', 'grupo', 'descricao', 'publica', 'atualizado_por', 'atualizado_em'],
    order: [['grupo', 'ASC'], ['chave', 'ASC']],
    raw: true,
  });

  const mapa = {};
  linhas.forEach((linha) => {
    mapa[linha.chave] = {
      id: linha.id,
      chave: linha.chave,
      /* já convertido: quem lê do cache não repete o trabalho de tipagem */
      valor: tipoService.converter(linha.valor, linha.tipo),
      bruto: linha.valor,
      tipo: linha.tipo,
      grupo: linha.grupo,
      descricao: linha.descricao,
      publica: linha.publica,
      atualizadoPor: linha.atualizado_por,
      atualizadoEm: linha.atualizado_em,
    };
  });

  return mapa;
}

/** mapa completo, do cache quando possível */
async function mapa() {
  return cache.lembrar(chaves.mapa(), carregar, { ttl: TTL_SEGUNDOS });
}

/* avisos de chave ausente ficam registrados uma vez por chave: um `obter` de
   chave inexistente dentro de um laço encheria o log de linhas idênticas e
   esconderia o resto */
const avisadas = new Set();

/**
 * API interna do módulo — é isto que as outras features consomem:
 *
 *   const configuracao = require('../configuracao');
 *   const dias = await configuracao.obter('anuncio.dias_validade', 60);
 *
 * **Nunca lança.** Configuração é ajuste, não dependência crítica: se a chave
 * sumir do banco, ou o banco estiver fora no meio de um job, a resposta certa é
 * seguir com o padrão do código e avisar — não derrubar a publicação de um
 * anúncio porque um parâmetro opcional não foi encontrado.
 *
 * Por isso o `padrao` não é opcional na prática: quem chama sempre sabe o valor
 * seguro para o seu caso.
 */
async function obter(chave, padrao = null) {
  try {
    const todas = await mapa();
    const item = todas?.[chave];

    if (!item) {
      if (!avisadas.has(chave)) {
        avisadas.add(chave);
        console.warn(`[configuracao] chave ausente: "${chave}" — usando o padrão do código`, { padrao });
      }
      return padrao;
    }

    return item.valor === null || item.valor === undefined ? padrao : item.valor;
  } catch (erro) {
    console.error('[configuracao] falha ao ler, seguindo com o padrão', { chave, mensagem: erro.message });
    return padrao;
  }
}

/**
 * Leitura em lote — uma consulta só, não uma por chave.
 *
 *   const { dias, maxFotos } = await obterVarias({
 *     dias: ['anuncio.dias_validade', 60],
 *     maxFotos: ['anuncio.max_fotos', 8],
 *   });
 */
async function obterVarias(pedido) {
  const todas = await mapa().catch(() => ({}));

  const resultado = {};
  Object.entries(pedido).forEach(([nome, definicao]) => {
    const [chave, padrao = null] = Array.isArray(definicao) ? definicao : [definicao, null];
    const item = todas?.[chave];

    if (!item) {
      if (!avisadas.has(chave)) {
        avisadas.add(chave);
        console.warn(`[configuracao] chave ausente: "${chave}" — usando o padrão do código`, { padrao });
      }
      resultado[nome] = padrao;
      return;
    }

    resultado[nome] = item.valor === null || item.valor === undefined ? padrao : item.valor;
  });

  return resultado;
}

/** registro completo (com tipo, grupo, descrição) — usado pelas telas de admin */
async function detalhe(chave) {
  const todas = await mapa();
  return todas?.[chave] || null;
}

/** todas as configurações, opcionalmente filtradas por grupo — exige `configuracao.ler` na rota */
async function listar({ grupo } = {}) {
  const todas = await mapa();
  const itens = Object.values(todas);
  return grupo ? itens.filter((item) => item.grupo === grupo) : itens;
}

/**
 * Subconjunto seguro para o front sem autenticação.
 *
 * Duas condições, e não uma: a chave precisa estar na lista branca do código
 * **e** ter `publica = true` no banco. A lista branca impede que um UPDATE
 * transforme configuração sensível em dado aberto; a coluna permite à Admin
 * fechar uma chave pública sem precisar de deploy. A mais restritiva vence.
 */
async function publicas() {
  const todas = await mapa();

  const resultado = {};
  PUBLICAS.forEach((chave) => {
    const item = todas?.[chave];
    if (item && item.publica) resultado[chave] = item.valor;
  });

  return resultado;
}

/** derruba o mapa em todas as instâncias — chamado pela escrita */
async function invalidar() {
  await cache.remover(chaves.mapa());
  await cache.invalidar(chaves.dominio());
}

/** usado no boot e nos testes: enche o cache antes da primeira requisição */
const preaquecer = () => mapa();

module.exports = {
  carregar,
  mapa,
  obter,
  obterVarias,
  detalhe,
  listar,
  publicas,
  invalidar,
  preaquecer,
};
