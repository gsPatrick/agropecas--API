'use strict';

const { QueryTypes } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const mapper = require('./busca.mapper');
const chavesCache = require('./busca.cache');
const { assinaturaDeRecorte } = require('./busca.filtro.service');
const { criarBinds, montarFiltro, FROM_BASE } = require('./busca.comum');
const { FACETAS_LIMITE, TTL_FACETAS } = require('./busca.constants');

/**
 * Facetas — "quantos anúncios em cada categoria", com os demais filtros já
 * aplicados.
 *
 * ─── por que é uma segunda consulta, e por que isso é aceitável ───
 *
 * Contar por categoria é uma agregação sobre o conjunto INTEIRO de resultados,
 * enquanto a lista é uma janela de 20 linhas. Não dá para tirar as duas da
 * mesma linha de retorno sem inflar cada uma das 20 linhas com o agregado
 * completo repetido — o que transformaria uma resposta de 30 KB em uma de
 * centenas.
 *
 * A escolha foi: **facetas são opcionais** (`?facetas=true`) e cacheadas por
 * 60s com a assinatura do recorte SEM paginação. Consequência prática: quem
 * pagina de 1 a 10 dispara a agregação uma vez só, e o front que não usa
 * facetas nunca paga por ela.
 *
 * ─── GROUPING SETS ───
 *
 * Quatro contagens (categoria, tipo, condição, UF) saem de UMA varredura. A
 * alternativa óbvia — quatro `GROUP BY` — reexecutaria o mesmo filtro caro
 * quatro vezes. `GROUPING()` marca de qual conjunto cada linha veio, porque
 * uma linha do bucket "tipo" tem a categoria nula e sem essa marca não dá para
 * distinguir de "anúncio sem categoria".
 */

/**
 * A faceta de categoria IGNORA o filtro de categoria.
 *
 * Contar categorias já filtrado por uma categoria devolveria uma linha só —
 * inútil na tela, onde o número existe justamente para o usuário decidir para
 * onde ir. É o mesmo motivo de a faceta de tipo ignorar o tipo.
 */
async function consultar(filtros) {
  const binds = criarBinds();
  const { where } = montarFiltro(filtros, binds, {
    ignorar: ['categoria', 'tipo', 'condicao'],
  });

  const sql = `
    WITH recorte AS (
      SELECT
        cat.slug AS categoria_slug,
        cat.nome AS categoria_nome,
        a.tipo,
        a.condicao,
        coalesce(mu.uf, a.uf) AS uf
      ${FROM_BASE}
      WHERE ${where}
    )
    SELECT
      grouping(categoria_slug, categoria_nome) AS g_categoria,
      grouping(tipo)                           AS g_tipo,
      grouping(condicao)                       AS g_condicao,
      grouping(uf)                             AS g_uf,
      categoria_slug, categoria_nome, tipo, condicao, uf,
      count(*)::int AS total
      FROM recorte
     GROUP BY GROUPING SETS ((categoria_slug, categoria_nome), (tipo), (condicao), (uf))
     ORDER BY total DESC
  `;
  /* sem LIMIT no SQL: um teto global cortaria as facetas de tipo/UF junto com
     as categorias, já que todas saem no mesmo resultado. O corte é aplicado
     por bucket abaixo, que é onde ele significa alguma coisa */

  const linhas = await db.sequelize.query(sql, { bind: binds.valores, type: QueryTypes.SELECT });

  const facetas = { categorias: [], tipos: [], condicoes: [], ufs: [] };

  linhas.forEach((linha) => {
    if (Number(linha.g_categoria) === 0 && linha.categoria_slug) {
      facetas.categorias.push(
        mapper.faceta({ valor: linha.categoria_slug, rotulo: linha.categoria_nome, total: linha.total })
      );
    } else if (Number(linha.g_tipo) === 0 && linha.tipo) {
      facetas.tipos.push(mapper.faceta({ valor: linha.tipo, total: linha.total }));
    } else if (Number(linha.g_condicao) === 0 && linha.condicao) {
      facetas.condicoes.push(mapper.faceta({ valor: linha.condicao, total: linha.total }));
    } else if (Number(linha.g_uf) === 0 && linha.uf) {
      facetas.ufs.push(mapper.faceta({ valor: linha.uf, total: linha.total }));
    }
  });

  /* a árvore de categorias pode ter dezenas de nós; a coluna de filtro do
     front mostra uma dúzia. Cortar aqui evita mandar cauda longa pela rede */
  facetas.categorias = facetas.categorias.slice(0, FACETAS_LIMITE);

  return facetas;
}

/** as facetas do recorte, cacheadas por 60s independentemente da página */
function calcular(filtros) {
  return cache.lembrar(
    chavesCache.chaves.facetas(assinaturaDeRecorte(filtros)),
    () => consultar(filtros),
    { ttl: TTL_FACETAS }
  );
}

module.exports = { calcular, consultar };
