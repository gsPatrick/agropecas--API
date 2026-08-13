'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const { erros } = require('../../utils/erros');
const mapper = require('./catalogo.mapper');
const chavesCache = require('./catalogo.cache');
const { TTL_CATALOGO } = require('./catalogo.constants');
const { filtroBusca } = require('./catalogo.comum');

/**
 * LEITURA de categorias: a árvore, a lista plana e o detalhe.
 *
 * Separado do CRUD porque são dois assuntos com pesos muito diferentes. Este
 * arquivo é o caminho quente do sistema — roda em toda tela, é servido do
 * cache e é onde um N+1 custa caro. O outro roda quando o Admin abre a tela de
 * gestão. Misturá-los faria a otimização de um esbarrar na regra do outro toda
 * vez que alguém mexesse.
 */

/** colunas que a API expõe — a tabela tem SEO que a árvore não usa */
const COLUNAS = [
  'id',
  'parent_id',
  'nome',
  'slug',
  'descricao',
  'tipo',
  'icone',
  'imagem_url',
  'ordem',
  'destaque',
  'ativo',
  'total_anuncios',
];

const ORDEM = [
  ['ordem', 'ASC'],
  ['nome', 'ASC'],
];

/** `ambos` serve aos dois lados: quem filtra por peça também quer vê-la */
function recorte({ tipo, incluirInativas, destaque }) {
  const where = {};
  if (!incluirInativas) where.ativo = true;
  if (tipo) where.tipo = { [Op.in]: [tipo, 'ambos'] };

  /* `destaque` é coluna booleana NOT NULL aqui (diferente de anúncio, onde é
     prazo), então a comparação direta basta */
  if (destaque !== undefined) where.destaque = destaque;

  return where;
}

/**
 * Monta a árvore em memória a partir de UMA consulta.
 *
 * A alternativa óbvia — buscar as raízes e, para cada uma, buscar as filhas —
 * é N+1 puro: com 12 raízes são 13 consultas para desenhar um menu que aparece
 * em toda tela. Aqui o banco devolve a lista plana já ordenada e o custo de
 * montar a hierarquia é um Map.
 */
function montarArvore(linhas) {
  const nos = new Map();
  linhas.forEach((linha) => nos.set(linha.id, { ...mapper.categoria(linha), filhas: [] }));

  const raizes = [];
  linhas.forEach((linha) => {
    const no = nos.get(linha.id);
    const pai = linha.parent_id ? nos.get(linha.parent_id) : null;

    /* filha cujo pai está fora do recorte (inativo, por exemplo) sobe para a
       raiz em vez de sumir: perder um galho inteiro porque alguém desativou o
       nó do meio é o tipo de bug que só aparece em produção */
    if (pai) pai.filhas.push(no);
    else raizes.push(no);
  });

  return raizes;
}

/**
 * A árvore inteira, cacheada por recorte de filtro.
 *
 * Não é paginada de propósito: um menu com metade dos galhos não é um menu, e
 * o front precisa do conjunto todo para desenhar o select em cascata. Quem
 * quer lista paginada usa `buscar()`.
 */
async function arvore({ tipo, incluirInativas = false, destaque } = {}) {
  /* `destaque` entra na assinatura: sem ele, o primeiro pedido com o filtro
     gravaria a árvore recortada na chave da árvore inteira e o menu de todo
     mundo passaria a mostrar cinco categorias até o TTL vencer */
  const assinatura = cache.assinatura({ tipo, inativas: incluirInativas, destaque });

  return cache.lembrar(
    chavesCache.chaves.arvore(assinatura),
    async () => {
      const linhas = await db.Categoria.findAll({
        where: recorte({ tipo, incluirInativas, destaque }),
        attributes: COLUNAS,
        order: ORDEM,
        raw: true,
      });

      return montarArvore(linhas);
    },
    { ttl: TTL_CATALOGO }
  );
}

/** listagem plana com busca — usada pelo autocomplete e pela tela do Admin */
async function buscar({ busca, tipo, incluirInativas = false, destaque } = {}, { limit, offset }) {
  const where = recorte({ tipo, incluirInativas, destaque });

  const porNome = filtroBusca('nome_normalizado', busca);
  if (porNome) Object.assign(where, porNome);

  const { rows, count } = await db.Categoria.findAndCountAll({
    where,
    attributes: COLUNAS,
    order: ORDEM,
    limit,
    offset,
    raw: true,
  });

  return { itens: rows.map(mapper.categoria), total: count };
}

async function porSlug(slug) {
  const registro = await db.Categoria.findOne({ where: { slug }, attributes: COLUNAS, raw: true });
  if (!registro) throw erros.naoEncontrado('Categoria');
  return mapper.categoria(registro);
}

module.exports = { arvore, buscar, porSlug, montarArvore, COLUNAS };
