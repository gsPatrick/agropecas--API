'use strict';

const db = require('../../models');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { lerPaginacao } = require('../../utils/paginacao');
const { COLUNAS_ANUNCIO, MAXIMO_IDS_POR_LOTE } = require('./favorito.constants');

/**
 * Leitura de favoritos: a lista do usuário, a checagem em lote e o contador
 * que o dono do anúncio enxerga.
 *
 * Assunto separado da escrita porque o risco é outro: aqui tudo é volume.
 */

/**
 * "Meus favoritos", paginado, com o anúncio junto.
 *
 * Três decisões que valem explicação:
 *
 * 1. **O dono é decidido pelo RBAC, nunca pelo parâmetro.** Favorito é dado
 *    pessoal: ninguém lê o de outro. Pedir a lista de terceiro exige
 *    `favorito.ler.todos` (na prática, Admin) e o `exigir` responde 403 antes
 *    de qualquer consulta. Sem alvo declarado, o alvo é sempre quem pediu.
 * 2. **`required: true` no include.** É o que faz o anúncio removido sumir da
 *    lista sem `WHERE deleted_at IS NULL` escrito à mão: o model é `paranoid`,
 *    o join vira INNER e a linha órfã simplesmente não volta. A FK é CASCADE,
 *    então o favorito some junto na exclusão definitiva; o INNER cobre a
 *    janela do soft delete.
 * 3. **`attributes` explícito.** `anuncios` guarda `descricao` e `busca_texto`
 *    em TEXT, e nenhum card usa nenhum dos dois.
 */
async function listar(contexto, filtros = {}) {
  const alvo = filtros.usuarioId || contexto.usuarioId;

  /* `exigir` com `donoId` cobre os dois casos numa linha: escopo `proprio`
     passa quando o alvo é o próprio usuário e lança 403 quando não é; escopo
     `todos` passa sempre. É a mesma checagem que `filtroDeEscopo` faria na
     listagem, só que aqui o alvo é único e explícito */
  exigir(contexto, 'favorito.ler', { donoId: alvo });

  const onde = { usuario_id: alvo };

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros);

  const ondeAnuncio = {};
  if (filtros.tipo) ondeAnuncio.tipo = filtros.tipo;
  if (filtros.status) ondeAnuncio.status = filtros.status;

  const { rows, count } = await db.Favorito.findAndCountAll({
    where: onde,
    include: [
      {
        model: db.Anuncio,
        as: 'anuncio',
        required: true,
        where: Object.keys(ondeAnuncio).length ? ondeAnuncio : undefined,
        attributes: COLUNAS_ANUNCIO,
        include: [
          {
            model: db.AnuncioFoto,
            as: 'fotos',
            required: false,
            /* só a capa: trazer as oito fotos de cada anúncio para desenhar
               uma miniatura é o N+1 disfarçado de include */
            where: { principal: true },
            attributes: ['id', 'url', 'url_thumb'],
          },
        ],
      },
    ],
    order: [['criado_em', 'DESC']],
    offset,
    limit,
    distinct: true,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

/**
 * "Quais destes anúncios eu já salvei?" — o ponto crítico do módulo.
 *
 * A listagem de anúncios precisa pintar o coração de 20 cards. A forma
 * ingênua é perguntar por card, e aí uma tela custa 20 idas ao banco; com
 * scroll infinito, centenas. Aqui é uma consulta só, `WHERE anuncio_id IN
 * (...)`, e sem `include` — a resposta é um conjunto de ids, não linhas.
 *
 * O retorno é um mapa `{ [anuncioId]: true }` em vez de lista: o front indexa
 * por id ao renderizar, e devolver array o obrigaria a montar o mapa de novo
 * ou a fazer `includes()` dentro do laço de render.
 */
async function marcados(contexto, anuncioIds = []) {
  const unicos = [...new Set(anuncioIds.filter(Boolean))].slice(0, MAXIMO_IDS_POR_LOTE);
  if (!unicos.length) return {};

  const linhas = await db.Favorito.findAll({
    where: { usuario_id: contexto.usuarioId, anuncio_id: unicos },
    attributes: ['anuncio_id'],
    raw: true,
  });

  return linhas.reduce((mapa, linha) => {
    mapa[linha.anuncio_id] = true;
    return mapa;
  }, {});
}

/**
 * Quantas pessoas salvaram este anúncio.
 *
 * Lê a coluna `total_favoritos`, não `COUNT(*)`: o dono abre o painel do
 * anúncio a cada dez minutos para ver se mexeu, e contar a tabela toda vez
 * seria pagar caro por um número que a escrita já mantém.
 *
 * O escopo é `anuncio.ver_metricas` e não `favorito.ler`: o número é métrica
 * do anúncio. Quem salvou continua invisível para o anunciante — saber que
 * "12 pessoas salvaram" é produto; saber *quem* seria expor interesse de
 * compra de terceiro sem que ele tenha se apresentado.
 */
async function contador(contexto, anuncioId) {
  const anuncio = await db.Anuncio.findByPk(anuncioId, {
    attributes: ['id', 'usuario_id', 'total_favoritos'],
  });
  if (!anuncio) throw erros.naoEncontrado('Anúncio');

  exigir(contexto, 'anuncio.ver_metricas', { donoId: anuncio.usuario_id });

  return { anuncioId: anuncio.id, total: anuncio.total_favoritos };
}

module.exports = { listar, marcados, contador };
