'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const { filtroDeEscopo } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { lerPaginacao } = require('../../utils/paginacao');
const mapper = require('./anuncio.mapper');
const acesso = require('./anuncio.acesso.service');
const { chaves } = require('./anuncio.cache');
const { INCLUDES_LISTA, INCLUDES_DETALHE } = require('./anuncio.relacoes');
const { CAMPOS_LISTA, CAMPOS_LISTA_MEUS, TTL } = require('./anuncio.constants');
const { coordenadaValida, caixaDeRaio } = require('../../utils/geo');
const { coordenadaDeMunicipio } = require('../busca/busca.localizacao.service');
const { RAIO_BUSCA_MAX_KM } = require('../localizacao/localizacao.constants');

/**
 * Leitura: vitrine pública, "meus anúncios", detalhe e parecidos.
 *
 * Duas obsessões neste arquivo, porque é o que o produto inteiro chama:
 *
 *  1. **Uma consulta.** O cartão da vitrine precisa de foto de capa, categoria
 *     e anunciante; buscar isso por anúncio dentro de um laço são 61 consultas
 *     numa página de 20. Tudo vem por `include`.
 *  2. **`attributes` explícito.** `descricao` é TEXT e nenhuma listagem a
 *     desenha — trazê-la é pagar rede e memória por dado que ninguém lê.
 *
 * O cache guarda o objeto JÁ MAPEADO, nunca instância do Sequelize: guardar a
 * instância significaria serializar métodos e o schema inteiro, e é o caminho
 * mais curto para vazar coluna nova sem ninguém decidir.
 */

/** filtros comuns da vitrine — cada um bate com um índice existente */
function montarFiltros(consulta = {}) {
  const where = {};

  if (consulta.tipo) where.tipo = consulta.tipo;
  if (consulta.condicao) where.condicao = consulta.condicao;
  if (consulta.negociacao) where.negociacao = consulta.negociacao;
  if (consulta.categoriaId) where.categoria_id = consulta.categoriaId;
  if (consulta.marcaId) where.marca_id = consulta.marcaId;

  /* `municipioId` tem dois sentidos, e só um vale por vez: fora de
     proximidade, é "só anúncios desta cidade" (filtro exato). Ordenando por
     proximidade, o mesmo campo vira a ORIGEM da distância — "a partir daqui",
     não "só daqui". Aplicar os dois juntos faria "perto de Sorriso" excluir
     Lucas do Rio Verde, que é o oposto do que a pessoa pediu. */
  if (consulta.municipioId && consulta.ordenar !== 'proximidade') {
    where.municipio_id = consulta.municipioId;
  }

  if (consulta.uf) where.uf = String(consulta.uf).toUpperCase();
  if (consulta.perfilId) where.perfil_id = consulta.perfilId;
  if (consulta.usuarioId) where.usuario_id = consulta.usuarioId;
  if (consulta.aceitaTroca !== undefined) where.aceita_troca = consulta.aceitaTroca;
  if (consulta.aceitaEntrega !== undefined) where.aceita_entrega = consulta.aceitaEntrega;

  /**
   * Destaque é PRAZO, não flag.
   *
   * A tabela guarda `destaque_ate`; "destacado" é esse prazo ainda no futuro —
   * a mesma conta que `anuncio.mapper` faz para devolver o booleano. Filtrar
   * por `destaque_ate IS NOT NULL` seria o erro fácil e mostraria na vitrine o
   * destaque que venceu semana passada, ou seja, entregaria de graça o que a
   * loja parou de pagar.
   *
   * `agora` é lido uma vez por consulta e não por linha: dentro do `where` o
   * banco resolve tudo com a mesma constante, e a comparação bate no índice de
   * `destaque_ate`.
   */
  if (consulta.destaque !== undefined) {
    const agora = new Date();

    where.destaque_ate = consulta.destaque
      ? { [Op.gt]: agora }
      /* o complemento tem de incluir o NULL: a maioria esmagadora dos anúncios
         nunca teve destaque, e `destaque_ate <= agora` sozinho deixaria todos
         eles de fora — SQL não compara NULL, ele some */
      : { [Op.or]: [{ [Op.lte]: agora }, { [Op.is]: null }] };
  }

  if (consulta.precoMin !== undefined || consulta.precoMax !== undefined) {
    where.preco_centavos = {};
    if (consulta.precoMin !== undefined) where.preco_centavos[Op.gte] = consulta.precoMin;
    if (consulta.precoMax !== undefined) where.preco_centavos[Op.lte] = consulta.precoMax;
  }

  return where;
}

const ORDENS = {
  recentes: [['publicado_em', 'DESC']],
  antigos: [['publicado_em', 'ASC']],
  preco_asc: [['preco_centavos', 'ASC']],
  preco_desc: [['preco_centavos', 'DESC']],
  populares: [['total_visualizacoes', 'DESC']],
};

/* ─────────────────────── proximidade ───────────────────────────
 *
 * Ordenar por distância PRECISA acontecer no banco. Enquanto isso não existia,
 * o front reordenava o array recebido — o que reordena apenas a página visível:
 * o vizinho que está na página 3 nunca sobe para a 1, e "os mais próximos de
 * você" mostra o anúncio de Sinop antes do da esquina. Com paginação, ordenar
 * no cliente está errado por definição, não por imprecisão.
 *
 * ─── por que Haversine em SQL e não PostGIS ───
 * O banco tem `uuid-ossp`, `pgcrypto`, `pg_trgm` e `unaccent`; PostGIS NÃO está
 * instalado (e exigir uma extensão do sistema operacional para ordenar uma
 * lista encareceria todo ambiente novo). Haversine em SQL puro dá o mesmo
 * resultado com erro de ~0,3% — 600 m em 200 km, irrelevante para "quanto
 * tempo de estrada até essa peça".
 *
 * ─── o custo, e como ele é contido ───
 * A conta é uma função escalar sem índice: sozinha, ela obriga a calcular
 * distância para TODA linha candidata antes de ordenar. Duas defesas:
 *
 *  1. **Caixa envolvente antes da conta.** `latitude BETWEEN … AND longitude
 *     BETWEEN …` é sargable e corta o grosso da tabela usando comparação
 *     barata. Só o que sobra paga trigonometria. Os cantos da caixa trazem
 *     alguns registros a mais — o `<= raio` exato descarta depois.
 *  2. **O filtro de status continua na frente.** `status = 'publicado'` bate no
 *     índice parcial da vitrine, então a caixa já opera sobre um subconjunto.
 *
 * Medição em EXPLAIN ANALYZE está no relatório da tarefa; com a base atual
 * (dezenas de anúncios) o plano é seq scan simplesmente porque a tabela cabe
 * em uma página — o ganho da caixa aparece quando a vitrine crescer.
 */

/**
 * Coordenada efetiva do anúncio, com a sede do município como plano B.
 *
 * A maioria dos anúncios não tem lat/lng próprios (o anunciante informou só a
 * cidade). Sem o COALESCE, "ordenar por proximidade" descartaria justamente a
 * maior parte da vitrine — o recurso pareceria quebrado.
 *
 * A subconsulta correlacionada é usada em vez de um JOIN porque o Sequelize
 * envolve a listagem numa subquery quando há `include` de coleção (fotos), e
 * dentro dela o alias da tabela de município não existe. Referenciar apenas
 * `"Anuncio"` é o que torna a expressão válida nos dois formatos de SQL que o
 * Sequelize pode gerar.
 */
const SQL_LAT = `COALESCE("Anuncio"."latitude", (SELECT m.latitude FROM municipios m WHERE m.id = "Anuncio"."municipio_id"))`;
const SQL_LNG = `COALESCE("Anuncio"."longitude", (SELECT m.longitude FROM municipios m WHERE m.id = "Anuncio"."municipio_id"))`;

/** número de verdade ou explode — o valor vai INTERPOLADO no SQL */
function numeroSeguro(valor, nome) {
  const convertido = Number(valor);
  if (!Number.isFinite(convertido)) throw erros.invalido(`Valor inválido para ${nome}.`);
  return convertido;
}

/**
 * Haversine em SQL.
 *
 * Os números são interpolados e não passados por bind porque a expressão entra
 * em `attributes`, `where` E `order` da mesma consulta — o Sequelize numera os
 * binds por cláusula e repetir o mesmo parâmetro três vezes é como se acaba
 * com "bind message supplies 2 parameters". `numeroSeguro` garante que só
 * número chega aqui, então não há superfície de injeção.
 */
function sqlDistanciaKm(origem) {
  const lat = numeroSeguro(origem.latitude, 'latitude');
  const lng = numeroSeguro(origem.longitude, 'longitude');

  return `(2 * 6371 * asin(sqrt(
    power(sin(radians(${SQL_LAT} - ${lat}) / 2), 2)
    + cos(radians(${lat})) * cos(radians(${SQL_LAT}))
    * power(sin(radians(${SQL_LNG} - ${lng}) / 2), 2)
  )))`;
}

/**
 * De onde a listagem parte.
 *
 * Três origens aceitas, na ordem de precisão: coordenada do GPS, id do
 * município (link compartilhado) e nome da cidade (o que o ViaCEP devolve).
 * A resolução de cidade → coordenada é a MESMA da busca
 * (`busca.localizacao.service`), reaproveitada de propósito: duas tabelas de
 * sede municipal em dois módulos é como se ganha dois resultados diferentes
 * para a mesma pergunta.
 */
async function resolverOrigem(consulta = {}) {
  const raioKm = consulta.raioKm
    ? Math.min(Math.max(1, Number(consulta.raioKm)), RAIO_BUSCA_MAX_KM)
    : null;

  if (Number.isFinite(Number(consulta.lat)) && Number.isFinite(Number(consulta.lng))) {
    const latitude = Number(consulta.lat);
    const longitude = Number(consulta.lng);
    if (coordenadaValida(latitude, longitude)) {
      return { latitude, longitude, raioKm, fonte: 'coordenada' };
    }
  }

  if (consulta.municipioId || consulta.cidade) {
    const sede = await coordenadaDeMunicipio({
      municipioId: consulta.municipioId,
      cidade: consulta.cidade,
      uf: consulta.uf,
    });
    if (sede && coordenadaValida(sede.latitude, sede.longitude)) {
      return { ...sede, raioKm, fonte: 'municipio' };
    }
  }

  return null;
}

/**
 * Acrescenta caixa + raio exato ao `where`.
 *
 * A caixa é o que aproveita o índice `(latitude, longitude)`; o `<= raio` é o
 * que corrige os cantos. Aplicar só o raio exato seria correto e lento;
 * aplicar só a caixa seria rápido e errado.
 */
function aplicarRaio(where, origem) {
  if (!origem?.raioKm) return where;

  const caixa = caixaDeRaio(origem.latitude, origem.longitude, origem.raioKm);
  if (!caixa) return where;

  const anteriores = where[Op.and] || [];

  return {
    ...where,
    [Op.and]: [
      ...anteriores,
      db.Sequelize.literal(
        `${SQL_LAT} BETWEEN ${caixa.latitudeMin} AND ${caixa.latitudeMax}`
      ),
      db.Sequelize.literal(
        `${SQL_LNG} BETWEEN ${caixa.longitudeMin} AND ${caixa.longitudeMax}`
      ),
      db.Sequelize.literal(`${sqlDistanciaKm(origem)} <= ${numeroSeguro(origem.raioKm, 'raioKm')}`),
    ],
  };
}

/**
 * Vitrine pública — só `publicado`, sem login.
 *
 * `status: 'publicado'` + ordem `publicado_em DESC` é exatamente a assinatura
 * do índice parcial `idx_anuncios_vitrine`, que é a consulta mais frequente do
 * produto. Mudar a ordem padrão daqui sem olhar o índice é trocar um index scan
 * por um seq scan na página inicial.
 */
async function vitrine(consulta = {}) {
  const { pagina, porPagina, offset, limit } = lerPaginacao(consulta);

  /* resolvida antes da chave de cache: "Sorriso" e o municipioId de Sorriso
     têm de cair na mesma entrada, senão o cache duplica a mesma vitrine */
  const origem =
    consulta.ordenar === 'proximidade' ? await resolverOrigem(consulta) : null;

  const assinatura = cache.assinatura({
    ...consulta,
    origem: origem ? { lat: origem.latitude, lng: origem.longitude, raioKm: origem.raioKm } : null,
    pagina,
    porPagina,
  });

  return cache.lembrar(
    chaves.lista(assinatura),
    async () => {
      let where = { ...montarFiltros(consulta), status: 'publicado' };
      const include = INCLUDES_LISTA();

      if (consulta.maquinaId) {
        include.push({
          model: db.Maquina,
          as: 'maquinasCompativeis',
          attributes: [],
          through: { attributes: [] },
          where: { id: consulta.maquinaId },
          required: true,
        });
      }

      /* sem origem, a vitrine paga só o SELECT de sempre — a maioria das
         visitas não pede proximidade, e trazer a coluna de distância à toa
         seria custo pago por todo mundo para beneficiar poucos */
      let attributes = CAMPOS_LISTA;
      let order = ORDENS[consulta.ordenar] || ORDENS.recentes;

      if (origem) {
        where = aplicarRaio(where, origem);
        attributes = { include: [[db.Sequelize.literal(sqlDistanciaKm(origem)), 'distancia_km']] };
        /* ORDER BY pela expressão, não pelo alias: o Sequelize monta uma
           subquery de paginação quando há include de coleção (fotos), e o
           alias declarado no SELECT externo não existe dentro dela */
        order = [[db.Sequelize.literal(sqlDistanciaKm(origem)), 'ASC']];
      }

      const { rows, count } = await db.Anuncio.findAndCountAll({
        where,
        attributes,
        include,
        order,
        offset,
        limit,
        distinct: true,
      });

      return { itens: rows.map(mapper.resumo), pagina, porPagina, total: count };
    },
    { ttl: TTL.VITRINE }
  );
}

/**
 * "Meus anúncios" — todos os status, inclusive rascunho.
 * O filtro vem do RBAC (`filtroDeEscopo`) e não de um `where` escrito à mão:
 * quem tem escopo total vê o de qualquer um, quem não tem vê só o seu, e a
 * decisão fica num lugar só.
 */
async function meus(contexto, consulta = {}) {
  const escopo = filtroDeEscopo(contexto, 'anuncio.ler', 'usuario_id');
  if (!escopo) return { itens: [], pagina: 1, porPagina: 0, total: 0 };

  const { pagina, porPagina, offset, limit } = lerPaginacao(consulta);

  const where = { ...escopo };
  /* sem escopo total, a listagem é sempre do próprio usuário — nunca do id
     que vier na query */
  if (Object.keys(escopo).length === 0) where.usuario_id = contexto.usuarioId;
  if (consulta.status) where.status = consulta.status;
  if (consulta.tipo) where.tipo = consulta.tipo;

  const { rows, count } = await db.Anuncio.findAndCountAll({
    where,
    attributes: CAMPOS_LISTA_MEUS,
    include: INCLUDES_LISTA(),
    order: consulta.ordenar === 'populares'
      ? ORDENS.populares
      : [['criado_em', consulta.ordenar === 'antigos' ? 'ASC' : 'DESC']],
    offset,
    limit,
    distinct: true,
  });

  return { itens: rows.map(mapper.resumoDono), pagina, porPagina, total: count };
}

/**
 * Detalhe.
 *
 * Anúncio publicado é público e vai para o cache. Fora disso (rascunho,
 * pausado, oculto, expirado), só o dono e quem tem escopo total enxergam — e
 * para todos os outros a resposta é 404, igual à de um id que não existe. Ver
 * `anuncio.acesso.service.js`.
 */
async function detalhe(contexto, id) {
  const publico = await cache.lembrar(
    chaves.detalhe(id),
    async () => {
      const registro = await db.Anuncio.findOne({
        where: { id, status: 'publicado' },
        include: INCLUDES_DETALHE(),
      });
      return registro ? mapper.detalhe(registro) : null;
    },
    { ttl: TTL.DETALHE }
  );

  /* o cache guarda só a versão pública, que é a de 99% das visitas; o dono
     paga uma consulta a mais para receber moderação e contadores */
  if (publico && !(contexto?.autenticado && (await gestorDe(contexto, id)))) {
    return { anuncio: publico, dono: false };
  }

  const registro = await db.Anuncio.findByPk(id, { include: INCLUDES_DETALHE() });
  if (!registro || !acesso.podeVerFora(contexto, registro)) throw erros.naoEncontrado('Anúncio');

  return { anuncio: mapper.detalhe(registro, { dono: true }), dono: true };
}

/** consulta barata para decidir se acrescenta o bloco de gestão ao cache público */
async function gestorDe(contexto, id) {
  const registro = await db.Anuncio.findByPk(id, { attributes: ['id', 'usuario_id'] });
  return Boolean(registro) && acesso.ehGestor(contexto, registro);
}

module.exports = { vitrine, meus, detalhe, montarFiltros };
