'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const { lerPaginacao } = require('../../utils/paginacao');
const { normalizar } = require('../../utils/texto');
const mapper = require('./perfil.mapper');
const chavesCache = require('./perfil.cache').chaves;
const { TTL_LISTA_SEGUNDOS } = require('./perfil.constants');

/**
 * Listagem pública de perfis — a vitrine de "quem existe na plataforma".
 *
 * Separada da consulta de detalhe porque são assuntos diferentes com riscos
 * diferentes: o detalhe é uma linha por chave única, a listagem é uma varredura
 * com filtro, e é ela que derruba banco quando alguém esquece o teto ou traz
 * uma coluna `TEXT` que a tela não usa.
 */

/**
 * Listagem pública paginada.
 *
 * Os filtros batem com os índices que o schema já tem (`tipo`, `municipio_id`,
 * `uf`). Serviço, marca e área de atendimento filtram por `include` com
 * `required: true` — vira `INNER JOIN`, que o Postgres resolve pelo índice
 * único da tabela de ligação, sem trazer a coleção inteira de volta.
 */
async function listar(filtros = {}) {
  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros, {
    porPaginaPadrao: 20,
    maximo: 50,
  });

  const where = {};
  if (filtros.tipo) where.tipo = filtros.tipo;
  if (filtros.municipioId) where.municipio_id = filtros.municipioId;
  if (filtros.uf) where.uf = String(filtros.uf).toUpperCase();
  if (filtros.verificado === true) where.verificado_em = { [Op.ne]: null };
  if (filtros.verificado === false) where.verificado_em = null;

  if (filtros.q) {
    /* `nome_exibicao` não tem coluna normalizada; `iLIKE` resolve o
       acento-insensível do jeito prático até existir índice de texto. Se a
       busca por perfil virar caminho quente, isto precisa de trigram — está
       registrado na documentação da feature */
    where.nome_exibicao = { [Op.iLike]: `%${normalizar(filtros.q)}%` };
  }

  const include = [
    { model: db.Municipio, as: 'municipio', attributes: ['id', 'nome', 'uf'], required: false },
  ];

  if (filtros.servicoId) {
    include.push({
      model: db.Servico,
      as: 'servicos',
      attributes: [],
      through: { attributes: [] },
      where: { id: filtros.servicoId },
      required: true,
    });
  }

  if (filtros.marcaId) {
    include.push({
      model: db.Marca,
      as: 'marcas',
      attributes: [],
      through: { attributes: [] },
      where: { id: filtros.marcaId },
      required: true,
    });
  }

  if (filtros.atendeMunicipioId) {
    include.push({
      model: db.Municipio,
      as: 'areaAtendimento',
      attributes: [],
      through: { attributes: [] },
      where: { id: filtros.atendeMunicipioId },
      required: true,
    });
  }

  const ordem = {
    recentes: [['criado_em', 'DESC']],
    anuncios: [['total_anuncios_ativos', 'DESC']],
    nome: [['nome_exibicao', 'ASC']],
  }[filtros.ordenar || 'recentes'];

  const assinatura = cache.assinatura({ ...filtros, pagina, porPagina });

  return cache.lembrar(
    chavesCache.lista(assinatura),
    async () => {
      const { rows, count } = await db.Perfil.findAndCountAll({
        where,
        include,
        /* lista branca de colunas: `bio` e `entrega_observacao` são TEXT e a
           tela de resultados não usa nenhum dos dois */
        attributes: [
          'id',
          'tipo',
          'slug',
          'nome_exibicao',
          'foto_url',
          'whatsapp',
          'exibir_whatsapp',
          'uf',
          'verificado_em',
          'total_anuncios_ativos',
          'criado_em',
        ],
        order: ordem,
        offset,
        limit,
        subQuery: false,
        distinct: true,
      });

      return {
        itens: rows.map(mapper.item),
        meta: { pagina, porPagina, total: Array.isArray(count) ? count.length : count },
      };
    },
    { ttl: TTL_LISTA_SEGUNDOS }
  );
}

module.exports = { listar };
