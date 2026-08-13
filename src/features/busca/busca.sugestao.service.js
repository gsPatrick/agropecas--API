'use strict';

const { QueryTypes } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const mapper = require('./busca.mapper');
const chavesCache = require('./busca.cache');
const { normalizarTermo } = require('./busca.comum');
const {
  TERMO_MINIMO,
  TTL_SUGESTAO,
  SUGESTOES_POR_FONTE,
  SUGESTOES_TOTAL,
} = require('./busca.constants');

/**
 * Autocomplete.
 *
 * Esta rota é chamada A CADA TECLA. Isso muda tudo em relação à busca normal:
 *
 *  • **cache longo (5 min).** O conjunto de sugestões para "rol" não muda em
 *    cinco minutos, e "rol", "rola", "rolam" são três chaves distintas que
 *    quase todo usuário digitando "rolamento" vai percorrer. Sem cache, cada
 *    palavra digitada custaria uma consulta.
 *  • **teto por fonte.** Cada bloco tem LIMIT próprio, então o pior caso é
 *    fixo e conhecido, independentemente de quantos anúncios existem.
 *  • **um round-trip.** As quatro fontes vêm em UNION ALL, não em quatro
 *    consultas — quatro idas ao banco a cada tecla é o que derruba o servidor
 *    de busca antes de qualquer outra coisa.
 *
 * Ordem das fontes na resposta: categoria e máquina antes de anúncio. Quem
 * digita "trator" quase sempre quer o filtro, não um anúncio específico — e o
 * filtro leva a uma lista, que é onde a conversão acontece.
 */

const BLOCO_CATEGORIA = `
  (SELECT 'categoria' AS fonte, c.nome AS rotulo, c.slug AS valor, c.slug AS alvo,
          word_similarity($1, c.nome_normalizado) AS nota, 3 AS peso
     FROM categorias c
    WHERE c.removido_em IS NULL AND c.ativo = true
      AND ($1 <% c.nome_normalizado OR c.nome_normalizado LIKE $1 || '%')
    ORDER BY nota DESC, c.total_anuncios DESC
    LIMIT $2)
`;

const BLOCO_MARCA = `
  (SELECT 'marca' AS fonte, m.nome AS rotulo, m.slug AS valor, m.slug AS alvo,
          word_similarity($1, m.nome_normalizado) AS nota, 2 AS peso
     FROM marcas m
    WHERE m.removido_em IS NULL AND m.ativo = true
      AND ($1 <% m.nome_normalizado OR m.nome_normalizado LIKE $1 || '%')
    ORDER BY nota DESC
    LIMIT $2)
`;

const BLOCO_MAQUINA = `
  (SELECT 'maquina' AS fonte, mk.modelo AS rotulo, mk.slug AS valor, mk.slug AS alvo,
          word_similarity($1, mk.modelo_normalizado) AS nota, 2 AS peso
     FROM maquinas mk
    WHERE mk.removido_em IS NULL AND mk.ativo = true
      AND ($1 <% mk.modelo_normalizado OR mk.modelo_normalizado LIKE $1 || '%')
    ORDER BY nota DESC
    LIMIT $2)
`;

/* o anúncio entra pelo TÍTULO, nunca pela descrição: sugerir uma frase tirada
   do meio de um texto longo produz sugestão que não parece termo de busca */
const BLOCO_ANUNCIO = `
  (SELECT 'anuncio' AS fonte, a.titulo AS rotulo, a.titulo AS valor, a.slug AS alvo,
          word_similarity($1, a.titulo_normalizado) AS nota, 1 AS peso
     FROM anuncios a
    WHERE a.removido_em IS NULL AND a.status = 'publicado'
      AND ($1 <% a.titulo_normalizado OR a.titulo_normalizado LIKE $1 || '%')
    ORDER BY nota DESC, a.publicado_em DESC
    LIMIT $2)
`;

const SQL = `
  SELECT fonte, rotulo, valor, alvo, nota
    FROM (
      ${BLOCO_CATEGORIA}
      UNION ALL
      ${BLOCO_MAQUINA}
      UNION ALL
      ${BLOCO_MARCA}
      UNION ALL
      ${BLOCO_ANUNCIO}
    ) uniao
   ORDER BY nota DESC, peso DESC
   LIMIT $3
`;

async function sugerir({ q, limite } = {}) {
  const termo = normalizarTermo(q);

  /* menos de dois caracteres casa com meio catálogo e a lista não ajuda em
     nada — devolver vazio é mais rápido e mais útil do que devolver ruído */
  if (termo.length < TERMO_MINIMO) return [];

  const total = Math.min(limite || SUGESTOES_TOTAL, 20);
  const assinatura = cache.assinatura({ q: termo, limite: total });

  return cache.lembrar(
    chavesCache.chaves.sugestao(assinatura),
    async () => {
      const linhas = await db.sequelize.query(SQL, {
        bind: [termo, SUGESTOES_POR_FONTE, total],
        type: QueryTypes.SELECT,
      });

      /* dois anúncios com título quase igual viram uma sugestão só: a lista
         com "Rolamento roda" três vezes parece bug para quem digita */
      const vistos = new Set();
      return linhas
        .filter((linha) => {
          const chave = `${linha.fonte}:${String(linha.valor).toLowerCase()}`;
          if (vistos.has(chave)) return false;
          vistos.add(chave);
          return true;
        })
        .map(mapper.sugestao);
    },
    { ttl: TTL_SUGESTAO, cachearVazio: true }
  );
}

module.exports = { sugerir, SQL };
