'use strict';

const { normalizar } = require('../../utils/texto');
const { RAIO_TERRA_KM, TERMO_MINIMO } = require('./busca.constants');

/**
 * A montagem de SQL da busca.
 *
 * Não é um service: não tem regra de negócio, não conhece contexto e não fala
 * com o banco. É o pedaço que a consulta de resultados e a de facetas precisam
 * escrever **igual** — se cada uma montasse o próprio `WHERE`, a contagem da
 * faceta divergiria da lista na primeira vez que alguém corrigisse só um lado.
 *
 * ─── por que SQL cru e não o query builder do Sequelize ───
 *
 * Três coisas que a busca precisa e o Sequelize não expressa sem virar
 * remendo: `word_similarity` (o "rolamentu acha rolamento"), `LEFT JOIN
 * LATERAL` para a foto de capa em uma consulta só, e `count(*) OVER ()` para
 * trazer o total junto com a página em vez de disparar um segundo COUNT.
 *
 * ─── injeção de SQL ───
 *
 * NENHUM valor vindo do usuário entra no texto da consulta. Todo valor passa
 * por `binds.add()`, que devolve um marcador `$n` e guarda o valor para o
 * driver — é o `bind` do Sequelize, parametrização de verdade no protocolo do
 * Postgres, não escape de string. O texto do SQL é 100% literal escrito aqui.
 */

/**
 * Acumulador de parâmetros. `add(valor)` devolve o marcador posicional e
 * guarda o valor na ordem certa.
 */
function criarBinds() {
  const valores = [];
  return {
    add(valor) {
      valores.push(valor);
      return `$${valores.length}`;
    },
    valores,
  };
}

/**
 * Expressão Haversine em SQL.
 *
 * `least/greatest` prendem o argumento do `acos` em [-1, 1]: erro de ponto
 * flutuante em coordenadas idênticas produz 1.0000000002 e o Postgres estoura
 * com "input is out of range" — falha que só aparece quando alguém busca
 * exatamente do próprio ponto.
 *
 * `coalesce(a.latitude, mu.latitude)` é o que faz a distância existir para o
 * anúncio que só informou a cidade: cai na sede do município, com
 * `precisao_localizacao` dizendo que é aproximada.
 */
function haversineSql(bindLat, bindLon) {
  const lat = `radians(coalesce(a.latitude, mu.latitude)::float8)`;
  const lon = `radians(coalesce(a.longitude, mu.longitude)::float8)`;
  return `(${RAIO_TERRA_KM} * acos(least(1, greatest(-1,
      sin(radians(${bindLat}::float8)) * sin(${lat})
    + cos(radians(${bindLat}::float8)) * cos(${lat}) * cos(${lon} - radians(${bindLon}::float8))
  ))))`;
}

/**
 * Caixa envolvente (bounding box) do raio.
 *
 * Calcular Haversine para a tabela inteira e depois filtrar é O(n) em função
 * seno — inaceitável. A caixa é uma comparação de faixa que o índice consegue
 * usar e derruba o conjunto para o retângulo antes de qualquer trigonometria;
 * o Haversine então só roda no que sobrou e corrige o canto do retângulo (a
 * caixa é maior que o círculo).
 *
 * 111.32 km é o comprimento de um grau de latitude. Em longitude o grau
 * encolhe com o cosseno da latitude — sem isso a caixa fica estreita demais
 * perto dos polos e larga demais no equador.
 */
function caixaEnvolvente(lat, lon, raioKm) {
  const deltaLat = raioKm / 111.32;
  const cos = Math.cos((lat * Math.PI) / 180);
  /* perto do polo o cosseno tende a zero e a divisão explode; 0.01 trava a
     caixa em "meio planeta", que é o comportamento correto ali */
  const deltaLon = raioKm / (111.32 * Math.max(0.01, Math.abs(cos)));

  return {
    latMin: lat - deltaLat,
    latMax: lat + deltaLat,
    lonMin: lon - deltaLon,
    lonMax: lon + deltaLon,
  };
}

/**
 * FROM + JOINs compartilhados pela lista e pelas facetas.
 *
 * Todos os JOINs são 1:1 (categoria, marca, município, perfil) — nenhum
 * multiplica linha, então não há risco de contagem inflada e não é preciso
 * DISTINCT. A compatibilidade com máquina, que é N:N, entra como `EXISTS` no
 * WHERE justamente por isso.
 */
const FROM_BASE = `
  FROM anuncios a
  LEFT JOIN categorias  cat ON cat.id = a.categoria_id
  LEFT JOIN marcas      mar ON mar.id = a.marca_id
  LEFT JOIN municipios  mu  ON mu.id  = a.municipio_id
  INNER JOIN perfis     p   ON p.id   = a.perfil_id AND p.removido_em IS NULL
`;

/**
 * Monta o `WHERE` a partir dos filtros já validados.
 *
 * `ignorar` permite que a faceta de categoria conte "quantos anúncios existem
 * em cada categoria **com os demais filtros aplicados**" — contar já filtrado
 * pela própria categoria devolveria sempre um número só, que é inútil na tela.
 *
 * Devolve também `relevancia` e `distancia`: são expressões, não colunas, e
 * quem monta o ORDER BY precisa da mesma string usada no SELECT.
 */
function montarFiltro(filtros, binds, { ignorar = [] } = {}) {
  const usa = (campo) => !ignorar.includes(campo);
  const cond = [];

  /* a base de tudo: só anúncio publicado e não removido sai daqui. Fica em
     primeiro e sem condicional nenhuma — é a linha que impede um rascunho de
     vazar por um filtro esquecido, e casa com `idx_anuncios_vitrine` */
  cond.push(`a.removido_em IS NULL`);
  cond.push(`a.status = 'publicado'`);

  let relevancia = null;

  const termo = filtros.termoNormalizado;
  if (usa('termo') && termo && termo.length >= TERMO_MINIMO) {
    const t = binds.add(termo);

    /* três caminhos, todos servidos pelos índices trigrama existentes:
       - `LIKE '%termo%'` acha a substring exata (gin_trgm_ops atende LIKE
         com curinga dos dois lados, que um btree jamais atenderia);
       - `<%` é word_similarity: acha "rolamento" digitando "rolamentu",
         comparando o termo contra a MELHOR palavra do texto — `%` puro
         compararia contra o texto inteiro e a similaridade de uma palavra
         dentro de uma descrição longa dá quase zero.

       As TRÊS condições são servidas por índice trigrama, e isso não é
       coincidência: basta UMA condição não indexável dentro do `OR` para o
       planejador desistir do BitmapOr e varrer a tabela inteira. Foi o que
       aconteceu na primeira versão, que tinha `codigo_peca_normalizado = $t`
       aqui e produzia Seq Scan em `anuncios` (medido: 343 ms com 20 mil
       linhas, contra 5 ms depois). O código de peça continua encontrável
       porque `busca_texto` já o contém — e continua pesando na relevância,
       onde não custa índice nenhum.

       `a.busca_texto` aparece sem `coalesce`: envolver a coluna numa função
       esconderia dela o índice `idx_anuncios_busca_trgm`. `NULL <% x` é NULL,
       que o `OR` trata como falso — exatamente o comportamento desejado. */
    cond.push(`(
      a.busca_texto LIKE '%' || ${t} || '%'
      OR ${t} <% a.titulo_normalizado
      OR ${t} <% a.busca_texto
    )`);

    /* Relevância: soma de sinais, não um número mágico do Postgres.
       O peso alto do código de peça e do título exato existe porque a
       intenção ali é inequívoca; a descrição pesa pouco porque texto longo
       casa com qualquer coisa. O empate final é resolvido por data no
       ORDER BY — entre dois iguais, o mais novo é o mais útil. */
    relevancia = `(
        CASE WHEN a.codigo_peca_normalizado = ${t} THEN 3.0 ELSE 0 END
      + CASE WHEN a.titulo_normalizado = ${t} THEN 2.0
             WHEN a.titulo_normalizado LIKE ${t} || '%' THEN 1.2
             WHEN a.titulo_normalizado LIKE '%' || ${t} || '%' THEN 0.8
             ELSE 0 END
      + word_similarity(${t}, a.titulo_normalizado) * 1.0
      + word_similarity(${t}, coalesce(a.busca_texto, '')) * 0.3
    )::float8`;
  }

  if (usa('tipo') && filtros.tipo) {
    cond.push(`a.tipo = ${binds.add(filtros.tipo)}`);
  }

  if (usa('condicao') && filtros.condicao) {
    cond.push(`a.condicao = ${binds.add(filtros.condicao)}`);
  }

  if (usa('negociacao') && filtros.negociacao) {
    cond.push(`a.negociacao = ${binds.add(filtros.negociacao)}`);
  }

  /**
   * Categoria vem por slug ou id e arrasta as filhas.
   *
   * Quem clica em "Peças" espera ver o que está em "Peças > Motor" — filtrar
   * só pelo nó exato devolveria vazio na categoria-pai, que é justamente onde
   * o usuário clica primeiro. A recursiva resolve isso DENTRO da mesma
   * consulta: buscar a árvore antes seria uma ida a mais ao banco em toda
   * busca filtrada.
   */
  if (usa('categoria') && filtros.categoria) {
    const c = binds.add(String(filtros.categoria));
    cond.push(`a.categoria_id IN (
      WITH RECURSIVE arvore AS (
        SELECT id FROM categorias
         WHERE removido_em IS NULL AND (slug = ${c} OR id::text = ${c})
        UNION ALL
        SELECT f.id FROM categorias f
          JOIN arvore ON f.parent_id = arvore.id
         WHERE f.removido_em IS NULL
      )
      SELECT id FROM arvore
    )`);
  }

  if (usa('marca') && filtros.marca) {
    const m = binds.add(String(filtros.marca));
    cond.push(`(mar.slug = ${m} OR mar.id::text = ${m})`);
  }

  /* N:N vira EXISTS e não JOIN: com JOIN, uma peça compatível com três
     máquinas apareceria três vezes na lista e três vezes na contagem */
  if (usa('maquina') && filtros.maquina) {
    const mq = binds.add(String(filtros.maquina));
    cond.push(`EXISTS (
      SELECT 1 FROM anuncio_maquinas am
        JOIN maquinas mk ON mk.id = am.maquina_id
       WHERE am.anuncio_id = a.id AND (mk.slug = ${mq} OR mk.id::text = ${mq})
    )`);
  }

  if (usa('uf') && filtros.uf) {
    cond.push(`a.uf = ${binds.add(filtros.uf)}`);
  }

  if (usa('municipio') && filtros.municipioId) {
    cond.push(`a.municipio_id = ${binds.add(filtros.municipioId)}`);
  } else if (usa('municipio') && filtros.cidadeNormalizada) {
    /* o front manda o nome que veio do ViaCEP ("Tangará da Serra"), não um id.
       A coluna já é gravada sem acento, então a comparação é direta e usa o
       btree de `nome_normalizado`; o prefixo cobre "tangara" digitado a mão */
    const cidade = binds.add(filtros.cidadeNormalizada);
    cond.push(`(mu.nome_normalizado = ${cidade} OR mu.nome_normalizado LIKE ${cidade} || '%')`);
  }

  /**
   * Preço.
   *
   * "A combinar" é um terceiro estado, não um preço zero: quem arrasta a faixa
   * para R$ 100–500 não quer ver "consultar valor" no meio, e quem marca
   * "a combinar" quer só esses. Por isso os dois filtros são exclusivos, e o
   * `preco_a_combinar = false` entra junto da faixa.
   */
  if (usa('preco')) {
    if (filtros.aCombinar === true) {
      cond.push(`a.preco_a_combinar = true`);
    } else {
      if (filtros.aCombinar === false) cond.push(`a.preco_a_combinar = false`);
      if (filtros.precoMinCentavos !== null && filtros.precoMinCentavos !== undefined) {
        cond.push(`a.preco_a_combinar = false AND a.preco_centavos >= ${binds.add(filtros.precoMinCentavos)}`);
      }
      if (filtros.precoMaxCentavos !== null && filtros.precoMaxCentavos !== undefined) {
        cond.push(`a.preco_a_combinar = false AND a.preco_centavos <= ${binds.add(filtros.precoMaxCentavos)}`);
      }
    }
  }

  /* "publicado nas últimas 24h/7/30 dias" — a data de corte é calculada no
     Node e entra como parâmetro, para o Postgres poder usar o índice em vez de
     avaliar `now() - interval` linha a linha */
  if (usa('dias') && filtros.dias) {
    const corte = new Date(Date.now() - filtros.dias * 24 * 60 * 60 * 1000);
    cond.push(`a.publicado_em >= ${binds.add(corte)}`);
  }

  if (usa('aceitaEntrega') && filtros.aceitaEntrega === true) {
    cond.push(`a.aceita_entrega = true`);
  }

  if (usa('aceitaTroca') && filtros.aceitaTroca === true) {
    cond.push(`a.aceita_troca = true`);
  }

  // ─── proximidade ────────────────────────────────────────────
  let distancia = null;
  if (usa('origem') && filtros.origemGeo) {
    const { latitude, longitude, raioKm } = filtros.origemGeo;
    const caixa = caixaEnvolvente(latitude, longitude, raioKm);

    const bLatMin = binds.add(caixa.latMin);
    const bLatMax = binds.add(caixa.latMax);
    const bLonMin = binds.add(caixa.lonMin);
    const bLonMax = binds.add(caixa.lonMax);

    /* a caixa é escrita em dois ramos em vez de um `coalesce` só porque o
       primeiro ramo (`a.latitude BETWEEN ...`) é sargável: se o índice
       geográfico existir, ele é usado; `coalesce(...) BETWEEN` nunca seria */
    cond.push(`(
         (a.latitude IS NOT NULL AND a.latitude BETWEEN ${bLatMin} AND ${bLatMax}
                                 AND a.longitude BETWEEN ${bLonMin} AND ${bLonMax})
      OR (a.latitude IS NULL AND mu.latitude BETWEEN ${bLatMin} AND ${bLatMax}
                             AND mu.longitude BETWEEN ${bLonMin} AND ${bLonMax})
    )`);

    const bLat = binds.add(latitude);
    const bLon = binds.add(longitude);
    distancia = haversineSql(bLat, bLon);

    /* corta o canto do retângulo: sem isto, "até 50 km" entregaria pontos a
       70 km na diagonal e o usuário perceberia na primeira busca */
    cond.push(`${distancia} <= ${binds.add(raioKm)}`);
  }

  return { where: cond.join('\n    AND '), relevancia, distancia };
}

/** normalização de texto reaproveitada pelo validador e pelo log */
const normalizarTermo = (valor) => normalizar(valor || '').replace(/\s+/g, ' ');

module.exports = {
  criarBinds,
  haversineSql,
  caixaEnvolvente,
  montarFiltro,
  normalizarTermo,
  FROM_BASE,
};
