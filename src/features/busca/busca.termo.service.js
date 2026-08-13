'use strict';

const { QueryTypes } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const mapper = require('./busca.mapper');
const chavesCache = require('./busca.cache');
const { TTL_TERMOS_POPULARES, RETENCAO_LOG_DIAS } = require('./busca.constants');

/**
 * "Peças mais procuradas hoje" — leitura e agregação.
 *
 * ─── por que existe uma tabela agregada ───
 *
 * A landing faz essa pergunta a CADA visita. Respondê-la varrendo `busca_logs`
 * cru é um `GROUP BY` sobre a tabela que mais cresce no sistema, na página que
 * mais recebe acesso — a combinação exata que derruba um banco no primeiro
 * mês de tração. `termos_populares` é o resultado já mastigado por um job.
 *
 * O custo dessa escolha é conhecido e aceito: o painel mostra o mundo de até
 * uma hora atrás. Para "o que o pessoal está procurando", uma hora de atraso
 * não muda nenhuma decisão de ninguém.
 */

/**
 * Os termos do dia.
 *
 * A janela de 7 dias como padrão, e não "hoje": às 8h da manhã o agregado de
 * hoje tem meia dúzia de linhas, e a seção da home apareceria vazia todo
 * começo de dia. Somar a semana dá uma lista estável, e o `ORDER BY` continua
 * privilegiando o que foi buscado mais vezes.
 */
async function populares({ uf, limite = 12, dias = 7 } = {}) {
  const assinatura = cache.assinatura({ uf, limite, dias });

  return cache.lembrar(
    chavesCache.chaves.termosPopulares(assinatura),
    async () => {
      const bind = [dias, limite];
      let filtroUf = '';

      if (uf) {
        bind.push(String(uf).toUpperCase());
        filtroUf = `AND t.uf = $${bind.length}`;
      }

      const linhas = await db.sequelize.query(
        `SELECT
            t.termo_normalizado,
            (array_agg(t.termo_exibicao ORDER BY t.data DESC))[1] AS termo_exibicao,
            sum(t.total_buscas)::int        AS total_buscas,
            sum(t.total_sem_resultado)::int AS total_sem_resultado,
            max(t.uf)                       AS uf
           FROM termos_populares t
          WHERE t.data >= (current_date - ($1::int - 1))
            ${filtroUf}
          GROUP BY t.termo_normalizado
          ORDER BY total_buscas DESC, t.termo_normalizado ASC
          LIMIT $2`,
        { bind, type: QueryTypes.SELECT }
      );

      return linhas.map(mapper.termoPopular);
    },
    { ttl: TTL_TERMOS_POPULARES, cachearVazio: true }
  );
}

/**
 * Buscas que não acharam nada.
 *
 * Não é curiosidade: é a lista de compras da plataforma. Termo procurado 40
 * vezes sem nenhum resultado é demanda existente sem oferta — a informação que
 * decide qual lojista convidar. Rota de Admin, não pública: publicar isso
 * entrega o mapa dos buracos do catálogo para o concorrente.
 */
async function semResultado({ dias = 30, limite = 50 } = {}) {
  return db.sequelize.query(
    `SELECT termo_normalizado,
            (array_agg(termo_exibicao ORDER BY data DESC))[1] AS termo_exibicao,
            sum(total_sem_resultado)::int AS total_sem_resultado,
            sum(total_buscas)::int        AS total_buscas,
            max(uf)                       AS uf
       FROM termos_populares
      WHERE data >= (current_date - ($1::int - 1))
        AND total_sem_resultado > 0
      GROUP BY termo_normalizado
      ORDER BY total_sem_resultado DESC
      LIMIT $2`,
    { bind: [dias, limite], type: QueryTypes.SELECT }
  );
}

/**
 * Agregação do dia — chamada pelo job periódico.
 *
 * ─── DELETE + INSERT, e não UPSERT ───
 *
 * O índice único é `(data, termo_normalizado, uf)` e `uf` é anulável. No
 * Postgres, NULL nunca é igual a NULL num índice único: o `ON CONFLICT` jamais
 * casaria para busca sem UF (que é a maioria) e cada execução do job
 * duplicaria as linhas silenciosamente. Reescrever o dia inteiro dentro de uma
 * transação é correto, idempotente e barato — é um dia de dados.
 *
 * Roda em UMA instrução `INSERT ... SELECT`: trazer os logs para o Node,
 * agrupar em memória e gravar linha a linha seria mover milhares de linhas
 * pela rede para fazer o que o banco faz em uma passada.
 */
async function agregarDia(data = new Date()) {
  const dia = data.toISOString().slice(0, 10);

  return db.sequelize.transaction(async (transaction) => {
    await db.sequelize.query(`DELETE FROM termos_populares WHERE data = $1`, {
      bind: [dia],
      type: QueryTypes.DELETE,
      transaction,
    });

    const [linhas] = await db.sequelize.query(
      `INSERT INTO termos_populares
         (id, data, termo_normalizado, termo_exibicao, uf,
          total_buscas, total_sem_resultado, criado_em, atualizado_em)
       SELECT
          gen_random_uuid(),
          $1::date,
          l.termo_normalizado,
          (array_agg(l.termo ORDER BY l.criado_em DESC))[1],
          l.uf,
          count(*)::int,
          count(*) FILTER (WHERE l.sem_resultado)::int,
          now(), now()
         FROM busca_logs l
        WHERE l.criado_em >= $1::date
          AND l.criado_em <  ($1::date + 1)
          AND l.termo_normalizado IS NOT NULL
          AND length(l.termo_normalizado) >= 2
        GROUP BY l.termo_normalizado, l.uf`,
      { bind: [dia], transaction }
    );

    return { data: dia, termos: Array.isArray(linhas) ? linhas.length : Number(linhas || 0) };
  });
}

/**
 * Descarte do log cru (LGPD — minimização e prazo).
 *
 * O agregado fica; o log individual, que carrega `ip_hash` e `sessao_hash`, é
 * apagado depois do prazo. Guardar por tempo indeterminado um registro de
 * comportamento pseudonimizado não tem finalidade declarada — e finalidade é
 * exatamente o que a lei exige para manter o dado.
 */
async function descartarLogsAntigos(dias = RETENCAO_LOG_DIAS) {
  const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  const removidos = await db.BuscaLog.destroy({ where: { criado_em: { [db.Sequelize.Op.lt]: corte } } });
  return { removidos, corte };
}

module.exports = { populares, semResultado, agregarDia, descartarLogsAntigos };
