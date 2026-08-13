'use strict';

const { Op, QueryTypes } = require('sequelize');
const db = require('../../models');
const { escopoDe, pode } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { lerPaginacao } = require('../../utils/paginacao');
const acessoService = require('../usuario/usuario.acesso.service');
const { STATUS_PENDENTES, RECURSO_ACESSO } = require('./denuncia.constants');

/**
 * Leitura de denúncias — a fila de trabalho da moderação e o acompanhamento de
 * quem denunciou.
 *
 * A ordenação é a alma da tela: cinco pessoas denunciando o mesmo anúncio é um
 * caso muito mais urgente do que cinco anúncios com uma denúncia cada. Por
 * isso a fila ordena por **quantidade de denúncias abertas no mesmo alvo**,
 * e essa contagem é feita **no banco**, numa subconsulta correlacionada — a
 * alternativa (buscar tudo e agrupar em JavaScript) só funciona enquanto a
 * tabela for pequena, e some justamente no dia em que a moderação importar.
 */

/**
 * Subconsulta de prioridade.
 *
 * Correlacionada e não `GROUP BY` externo porque o resultado precisa vir junto
 * de cada linha da página — um agrupamento à parte exigiria uma segunda ida ao
 * banco e a junção manual dos dois conjuntos.
 */
const PRIORIDADE = db.Sequelize.literal(`(
  SELECT COUNT(*) FROM denuncias AS irmas
   WHERE irmas.alvo_tipo = "Denuncia"."alvo_tipo"
     AND irmas.alvo_id   = "Denuncia"."alvo_id"
     AND irmas.status IN ('aberta', 'em_analise')
)`);

/** exige escopo total: a fila de moderação não é uma lista "quase própria" */
function exigirEscopoDeModeracao(contexto) {
  if (escopoDe(contexto, 'denuncia.ler') === 'todos') return;
  throw erros.semPermissao('Você não tem permissão para ver a fila de denúncias.', {
    permissao: 'denuncia.ler.todas',
  });
}

/** fila de moderação, paginada e priorizada */
async function listar(contexto, filtros = {}) {
  exigirEscopoDeModeracao(contexto);

  const where = {};
  if (filtros.status) where.status = filtros.status;
  else where.status = { [Op.in]: STATUS_PENDENTES };

  if (filtros.alvoTipo) where.alvo_tipo = filtros.alvoTipo;
  if (filtros.motivo) where.motivo = filtros.motivo;

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros);

  const { rows, count } = await db.Denuncia.findAndCountAll({
    where,
    attributes: { include: [[PRIORIDADE, 'denuncias_no_alvo']] },
    /* mais denúncias primeiro; empate desempata pela mais antiga, para que
       nada fique esquecido no fim da fila para sempre */
    order: [[PRIORIDADE, 'DESC'], ['criado_em', 'ASC']],
    offset,
    limit,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

/**
 * Agrupamento por alvo — a visão "o que está pegando fogo".
 *
 * `GROUP BY` no banco (PADRÃO_MODULO §10). Consulta crua porque o que se quer
 * aqui não é um conjunto de models, é um relatório: agregar com o ORM
 * devolveria instâncias falsas do Sequelize com colunas que não existem.
 */
async function agrupadasPorAlvo(contexto, filtros = {}) {
  exigirEscopoDeModeracao(contexto);

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros, { porPaginaPadrao: 20, maximo: 50 });

  const filtroTipo = filtros.alvoTipo ? 'AND alvo_tipo = :alvoTipo' : '';
  const substituicoes = { limite: limit, deslocamento: offset, alvoTipo: filtros.alvoTipo };

  const linhas = await db.sequelize.query(
    `SELECT alvo_tipo,
            alvo_id,
            MAX(denunciado_id::text)::uuid AS denunciado_id,
            COUNT(*)                        AS total,
            COUNT(*) FILTER (WHERE status IN ('aberta','em_analise')) AS abertas,
            ARRAY_AGG(DISTINCT motivo::text) AS motivos,
            MIN(criado_em)                  AS primeira_em,
            MAX(criado_em)                  AS ultima_em
       FROM denuncias
      WHERE 1 = 1 ${filtroTipo}
      GROUP BY alvo_tipo, alvo_id
     HAVING COUNT(*) FILTER (WHERE status IN ('aberta','em_analise')) > 0
      ORDER BY abertas DESC, ultima_em DESC
      LIMIT :limite OFFSET :deslocamento`,
    { replacements: substituicoes, type: QueryTypes.SELECT }
  );

  const [{ total }] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM (
       SELECT 1 FROM denuncias
        WHERE 1 = 1 ${filtroTipo}
        GROUP BY alvo_tipo, alvo_id
       HAVING COUNT(*) FILTER (WHERE status IN ('aberta','em_analise')) > 0
     ) AS grupos`,
    { replacements: substituicoes, type: QueryTypes.SELECT }
  );

  return { itens: linhas, pagina, porPagina, total: Number(total) };
}

/** acompanhamento de quem denunciou — sempre só as próprias */
async function minhas(contexto, filtros = {}) {
  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros);

  const { rows, count } = await db.Denuncia.findAndCountAll({
    where: { denunciante_id: contexto.usuarioId },
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

/**
 * Detalhe. 404 e não 403 quando a denúncia não é sua e você não modera:
  * responder diferente confirmaria a existência do registro para quem só está
 * varrendo UUIDs (PADRÃO_MODULO §11.5).
 */
async function ver(contexto, id) {
  const denuncia = await db.Denuncia.findByPk(id, {
    attributes: { include: [[PRIORIDADE, 'denuncias_no_alvo']] },
  });
  if (!denuncia) throw erros.naoEncontrado('Denúncia');

  const daModeracao = escopoDe(contexto, 'denuncia.ler') === 'todos';
  const minhaPropria = String(denuncia.denunciante_id) === String(contexto.usuarioId);

  if (!daModeracao && !minhaPropria) throw erros.naoEncontrado('Denúncia');

  /* a identidade do denunciante só sai para quem pode abrir dado pessoal de
     terceiro — e a abertura fica registrada (LGPD). Ver denuncia.mapper.js */
  const podeVerDenunciante =
    daModeracao && pode(contexto, 'lgpd.acessar_dado_pessoal', {});

  if (daModeracao && denuncia.denunciado_id) {
    await acessoService.registrarLeitura(contexto, {
      titularId: denuncia.denunciado_id,
      recurso: RECURSO_ACESSO,
      recursoId: denuncia.id,
      motivo: `apuração da denúncia ${denuncia.id}`,
    });
  }

  return { denuncia, podeVerDenunciante, daModeracao };
}

module.exports = { listar, agrupadasPorAlvo, minhas, ver, exigirEscopoDeModeracao, PRIORIDADE };
