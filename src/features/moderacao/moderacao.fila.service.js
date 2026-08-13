'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const { lerPaginacao } = require('../../utils/paginacao');
const { exigirEscopoTotal } = require('./moderacao.comum');
const { FILA_STATUS } = require('./moderacao.constants');

/**
 * A fila de trabalho: anúncios esperando decisão.
 *
 * O requisito de performance aqui é explícito no PADRÃO_MODULO §10.1 — anúncio
 * + dono + contagem de denúncias em UMA consulta. Buscar a página e depois
 * percorrer chamando `findByPk` no dono seria 21 consultas por tela, e a fila
 * é a tela que o moderador mantém aberta o dia inteiro.
 *
 * O dono vem por `include` (JOIN); a contagem de denúncias vem por subconsulta
 * correlacionada. Não uso a coluna `anuncios.total_denuncias` para ordenar
 * porque ela conta o histórico inteiro — um anúncio com dez denúncias todas
 * já julgadas improcedentes ficaria eternamente no topo da fila.
 */

const DENUNCIAS_ABERTAS = db.Sequelize.literal(`(
  SELECT COUNT(*) FROM denuncias AS d
   WHERE d.alvo_tipo = 'anuncio'
     AND d.alvo_id   = "Anuncio"."id"
     AND d.status IN ('aberta', 'em_analise')
)`);

/** o dono, com o mínimo que a linha da fila mostra */
const INCLUIR_DONO = {
  model: db.Usuario,
  as: 'usuario',
  attributes: ['id', 'nome', 'email', 'status'],
  required: false,
};

/**
 * Colunas explícitas: `descricao` e `busca_texto` são TEXT e não cabem — nem
 * fazem falta — numa listagem de 20 linhas (PADRÃO_MODULO §10.3).
 */
const CAMPOS_FILA = [
  'id',
  'codigo',
  'titulo',
  'slug',
  'tipo',
  'status',
  'moderacao_status',
  'moderacao_motivo',
  'moderado_em',
  'preco_centavos',
  'uf',
  'usuario_id',
  'total_denuncias',
  'publicado_em',
  'criado_em',
];

async function listar(contexto, filtros = {}) {
  exigirEscopoTotal(contexto, 'anuncio.ler');

  const where = {};

  where.moderacao_status = filtros.moderacaoStatus
    ? filtros.moderacaoStatus
    : { [Op.in]: FILA_STATUS };

  if (filtros.status) where.status = filtros.status;
  /* removido é lixeira, não fila: nada a decidir sobre o que já saiu do ar */
  else where.status = { [Op.ne]: 'removido' };

  if (filtros.uf) where.uf = String(filtros.uf).toUpperCase();

  if (filtros.somenteDenunciados) {
    where[Op.and] = [db.Sequelize.where(DENUNCIAS_ABERTAS, { [Op.gt]: 0 })];
  }

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros);

  const { rows, count } = await db.Anuncio.findAndCountAll({
    where,
    attributes: [...CAMPOS_FILA, [DENUNCIAS_ABERTAS, 'denuncias_abertas']],
    include: [INCLUIR_DONO],
    /* o mais denunciado primeiro; sem denúncia, o mais antigo — assim nada
       envelhece indefinidamente na fila só porque ninguém reclamou dele */
    order: [[DENUNCIAS_ABERTAS, 'DESC'], ['criado_em', 'ASC']],
    offset,
    limit,
    /* belongsTo não multiplica linha, mas `distinct` protege a contagem de
       quem adicionar um `hasMany` neste include amanhã */
    distinct: true,
    subQuery: false,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

/** um anúncio da fila, com o dono e as denúncias abertas contra ele */
async function ver(contexto, anuncioId) {
  exigirEscopoTotal(contexto, 'anuncio.ler');

  const anuncio = await db.Anuncio.findByPk(anuncioId, {
    attributes: { include: [[DENUNCIAS_ABERTAS, 'denuncias_abertas']] },
    include: [
      INCLUIR_DONO,
      { model: db.AnuncioFoto, as: 'fotos', attributes: ['id', 'url', 'ordem', 'principal', 'bloqueada'] },
    ],
  });

  return anuncio;
}

module.exports = { listar, ver, DENUNCIAS_ABERTAS, CAMPOS_FILA };
