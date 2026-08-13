'use strict';

const { QueryTypes } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const mapper = require('./busca.mapper');
const chavesCache = require('./busca.cache');
const { criarBinds, montarFiltro, FROM_BASE } = require('./busca.comum');
const { ORDEM, TTL_RESULTADO } = require('./busca.constants');

/**
 * A consulta de resultados — o coração do módulo.
 *
 * ─── uma ida ao banco, e o formato que a torna barata ───
 *
 * Uma única instrução devolve a página de anúncios, o total geral, a
 * categoria, a marca, o município, o anunciante e a foto de capa de cada item.
 * A FORMA dessa instrução foi escolhida com `EXPLAIN ANALYZE` na mão, e as
 * duas decisões abaixo foram medidas, não deduzidas:
 *
 * 1. **`WITH base ... LIMIT` primeiro, colunas e foto depois.**
 *    A versão óbvia junta tudo no mesmo `FROM` e deixa o `LIMIT` no fim. O
 *    problema é que o `LEFT JOIN LATERAL` da foto roda ANTES do `LIMIT`: numa
 *    busca com 1.300 resultados, o banco procurava 1.300 fotos para mostrar
 *    20. Aqui o CTE `base` reduz a 20 ids primeiro; só então os JOINs e a
 *    LATERAL rodam — 20 buscas por índice, e não 1.300.
 *
 * 2. **`count(*)` em CTE próprio, não `count(*) OVER ()`.**
 *    A janela obriga o banco a materializar TODAS as linhas do resultado antes
 *    de aplicar o `LIMIT`, porque o total precisa delas. Na vitrine sem filtro
 *    (19 mil anúncios) isso mediu **26 ms**; o mesmo resultado com o total em
 *    CTE separado, que o Postgres resolve com Index Only Scan, mediu **2,3 ms**
 *    — dez vezes menos, e a distância cresce com a tabela. Em busca com termo
 *    os dois empatam, porque o filtro precisa ser avaliado de qualquer jeito.
 *    Continua sendo UM round-trip e UMA transação implícita, então o total
 *    nunca discorda da lista.
 *
 * 3. **Sem `NULLS LAST` na data.** `publicado_em DESC NULLS LAST` não casa com
 *    `idx_anuncios_vitrine`, que é `DESC` puro — e o Postgres trocava o Index
 *    Scan por um Sort de 19 mil linhas (47 ms contra 15 ms). Anúncio publicado
 *    sem `publicado_em` é inconsistência de dado, não caso a tratar na
 *    ordenação.
 *
 * ─── colunas explícitas ───
 *
 * `descricao` é TEXT e não aparece na listagem. Trazê-la seria transferir
 * dezenas de KB por página para um dado que a tela nem renderiza — e é o tipo
 * de desperdício que só aparece na conta de rede.
 */

/** o que a listagem realmente precisa. `a.descricao` fica de fora de propósito */
const COLUNAS = `
  a.id, a.codigo, a.slug, a.titulo, a.tipo, a.condicao, a.negociacao,
  a.preco_centavos, a.preco_a_combinar, a.aceita_troca, a.aceita_entrega,
  a.quantidade, a.unidade, a.codigo_peca,
  a.uf, a.municipio_id, a.publicado_em, a.destaque_ate,
  a.total_visualizacoes, a.total_favoritos,
  a.latitude, a.longitude, a.precisao_localizacao,

  cat.slug AS categoria_slug, cat.nome AS categoria_nome, cat.icone AS categoria_icone,
  mar.slug AS marca_slug,     mar.nome AS marca_nome,
  mu.nome  AS municipio_nome, mu.uf AS municipio_uf,
  mu.latitude AS municipio_latitude, mu.longitude AS municipio_longitude,

  p.id AS perfil_id, p.slug AS perfil_slug, p.nome_exibicao AS perfil_nome,
  p.tipo AS perfil_tipo, p.foto_url AS perfil_foto, p.verificado_em AS perfil_verificado_em,
  p.whatsapp AS perfil_whatsapp, p.exibir_whatsapp, p.exibir_endereco_exato,

  foto.url AS foto_url, foto.url_thumb AS foto_thumb, foto.texto_alternativo AS foto_alt
`;

/**
 * Foto de capa em LATERAL.
 *
 * `principal DESC` antes de `ordem`: o anunciante que marcou uma capa quer
 * aquela; quem não marcou nenhuma cai na primeira da ordem. Foto bloqueada
 * pela moderação nunca entra — se a imagem foi removida por conteúdo impróprio,
 * ela não pode continuar sendo o cartão do anúncio na busca.
 */
const LATERAL_FOTO = `
  LEFT JOIN LATERAL (
    SELECT f.url, f.url_thumb, f.texto_alternativo
      FROM anuncio_fotos f
     WHERE f.anuncio_id = a.id
       AND f.removido_em IS NULL
       AND f.bloqueada = false
     ORDER BY f.principal DESC, f.ordem ASC
     LIMIT 1
  ) foto ON true
`;

/**
 * ORDER BY.
 *
 * Recebe as EXPRESSÕES de relevância e distância porque a mesma ordenação é
 * escrita duas vezes: dentro do CTE (onde são contas) e fora dele (onde já são
 * colunas do CTE). Escrever as duas à mão garantiria que um dia elas divirjam.
 *
 * Todas terminam em `a.id ASC`. Sem esse desempate a ordem entre linhas de
 * mesmo valor é indefinida, e a página 2 pode repetir um item que a página 1
 * já mostrou — o bug de paginação mais difícil de reproduzir que existe.
 *
 * `NULLS LAST` no preço (e só nele): "a combinar" não é barato nem caro, e
 * misturado no meio da faixa embaralha a leitura da lista. Na data ele é
 * omitido de propósito — ver o comentário do topo do arquivo.
 */
function montarOrdem(ordem, { relevancia, distancia, anuncio = 'a' } = {}) {
  const porData = `${anuncio}.publicado_em DESC`;
  const desempate = `${anuncio}.id ASC`;

  switch (ordem) {
    case ORDEM.MENOR_PRECO:
      return `${anuncio}.preco_centavos ASC NULLS LAST, ${porData}, ${desempate}`;
    case ORDEM.MAIOR_PRECO:
      return `${anuncio}.preco_centavos DESC NULLS LAST, ${porData}, ${desempate}`;
    case ORDEM.PROXIMOS:
      return `${distancia ? `${distancia} ASC NULLS LAST, ` : ''}${porData}, ${desempate}`;
    case ORDEM.RELEVANCIA:
      return `${relevancia ? `${relevancia} DESC, ` : ''}${porData}, ${desempate}`;
    default:
      return `${porData}, ${desempate}`;
  }
}

/**
 * Monta o SQL e a lista de parâmetros.
 *
 * `montarFiltro` é chamado DUAS vezes sobre o mesmo acumulador de binds — uma
 * para a página, outra para o total. Os valores aparecem repetidos na lista de
 * parâmetros, e isso é intencional: reaproveitar os marcadores exigiria que o
 * montador soubesse em quantos lugares ele será usado, e um `$3` apontando
 * para o filtro errado é o tipo de bug que passa em teste e vaza dado em
 * produção.
 */
function montarSql(filtros) {
  const binds = criarBinds();
  const pagina = montarFiltro(filtros, binds);

  const ordemInterna = montarOrdem(filtros.ordem, {
    relevancia: pagina.relevancia,
    distancia: pagina.distancia,
  });

  const limite = binds.add(filtros.limit);
  const deslocamento = binds.add(filtros.offset);

  /* segunda montagem: mesmo recorte, contando. Só `anuncios` e os JOINs que o
     filtro exige entram aqui — nada de foto, que não muda a contagem */
  const totalizacao = montarFiltro(filtros, binds);

  const ordemExterna = montarOrdem(filtros.ordem, {
    relevancia: 'base.relevancia',
    distancia: 'base.distancia_km',
  });

  const sql = `
    WITH base AS (
      SELECT
        a.id,
        a.publicado_em,
        a.preco_centavos,
        ${pagina.relevancia ? `${pagina.relevancia}` : 'NULL::float8'} AS relevancia,
        ${pagina.distancia ? `${pagina.distancia}` : 'NULL::float8'} AS distancia_km
      ${FROM_BASE}
      WHERE ${pagina.where}
      ORDER BY ${ordemInterna}
      LIMIT ${limite} OFFSET ${deslocamento}
    ),
    total AS (
      SELECT count(*)::int AS quantidade
      ${FROM_BASE}
      WHERE ${totalizacao.where}
    )
    SELECT
      ${COLUNAS},
      base.relevancia,
      base.distancia_km,
      total.quantidade AS total_geral
    FROM base
    JOIN anuncios     a   ON a.id = base.id
    LEFT JOIN categorias cat ON cat.id = a.categoria_id
    LEFT JOIN marcas     mar ON mar.id = a.marca_id
    LEFT JOIN municipios mu  ON mu.id  = a.municipio_id
    JOIN perfis          p   ON p.id   = a.perfil_id
    ${LATERAL_FOTO}
    CROSS JOIN total
    ORDER BY ${ordemExterna}
  `;

  return { sql, binds: binds.valores };
}

/** executa a consulta de fato — sem cache, sem log; só SQL */
async function consultar(filtros) {
  const { sql, binds } = montarSql(filtros);

  const linhas = await db.sequelize.query(sql, { bind: binds, type: QueryTypes.SELECT });

  return {
    itens: linhas.map(mapper.resultado),
    /* zero linhas na página não significa zero no total: pode ser página 5 de
       um resultado de 3 páginas (link antigo). O total real vem do CTE, e
       quando não há linha nenhuma para lê-lo, é porque o recorte é vazio */
    total: linhas.length ? Number(linhas[0].total_geral) : await contar(filtros),
  };
}

/**
 * Total isolado — só é usado quando a página pedida está além do fim.
 *
 * Sem isto, um link com `?p=99` devolveria `total: 0` e o front concluiria que
 * a busca não achou nada, quando na verdade achou 40 itens em 2 páginas.
 */
async function contar(filtros) {
  const binds = criarBinds();
  const { where } = montarFiltro(filtros, binds);

  const linhas = await db.sequelize.query(
    `SELECT count(*)::int AS quantidade ${FROM_BASE} WHERE ${where}`,
    { bind: binds.valores, type: QueryTypes.SELECT }
  );

  return Number(linhas[0]?.quantidade || 0);
}

/**
 * Consulta com cache.
 *
 * A mesma busca repetida em 45s não vai ao banco. Na prática isso cobre três
 * padrões reais e frequentes: o link compartilhado no grupo do WhatsApp que 20
 * pessoas abrem ao mesmo tempo, o usuário que volta da página do anúncio para a
 * lista, e o raspador que pagina o catálogo inteiro.
 *
 * O que é guardado é objeto simples vindo do mapper — instância do Sequelize
 * não sobrevive à serialização e voltaria do Redis como um objeto meio vivo.
 */
async function buscar(filtros) {
  const chave = chavesCache.chaves.resultado(filtros.assinatura);

  const guardado = await cache.obter(chave);
  if (guardado !== undefined) return { ...guardado, doCache: true };

  const resultado = await consultar(filtros);

  /* resultado vazio TAMBÉM é cacheado: busca sem resultado é exatamente a que
     um raspador repete, e é a mais barata de servir da memória */
  await cache.gravar(chave, resultado, { ttl: TTL_RESULTADO });

  return { ...resultado, doCache: false };
}

/** SQL montado sem executar — usado pela documentação e pelo EXPLAIN ANALYZE */
const explicar = (filtros) => montarSql(filtros);

module.exports = { buscar, consultar, contar, explicar, montarSql, COLUNAS };
