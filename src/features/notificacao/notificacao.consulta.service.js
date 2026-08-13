'use strict';

const db = require('../../models');
const { filtroDeEscopo, escopoDe } = require('../../rbac');
const { lerPaginacao } = require('../../utils/paginacao');
const mapper = require('./notificacao.mapper');
const { LISTA_MAXIMO } = require('./notificacao.constants');

const { Op } = db.Sequelize;

/**
 * Leitura da caixa de notificações.
 *
 * Notificação é dado pessoal: o corpo diz o que aconteceu com a conta da
 * pessoa, com quem ela conversou e o que foi moderado. Por isso o escopo entra
 * na CONSULTA (`filtroDeEscopo`), não num `filter` depois — buscar tudo e
 * peneirar na aplicação já colocou o dado alheio dentro do processo, e basta
 * um `console.log` esquecido para ele sair.
 */

/** só o que a lista precisa: `dados` é JSONB e `corpo` é TEXT, o resto é peso */
const ATRIBUTOS = [
  'id',
  'usuario_id',
  'tipo',
  'canal',
  'titulo',
  'corpo',
  'link',
  'dados',
  'referencia_tipo',
  'referencia_id',
  'lida_em',
  'criado_em',
];

/**
 * @param filtros.lida     true (só lidas) · false (só não lidas) · undefined (todas)
 * @param filtros.tipo     um tipo do enum
 * @param filtros.canal    padrão `sistema` — a linha de e-mail é registro de
 *                         entrega, não item de caixa de entrada
 */
async function listar(contexto, filtros = {}) {
  const escopo = filtroDeEscopo(contexto, 'notificacao.ler', 'usuario_id');

  /* null = não pode nada. Lista vazia e não 403: a rota já exigiu a
     capacidade, e chegar aqui sem escopo é caso de papel mal configurado */
  if (!escopo) return { itens: [], total: 0, pagina: 1, porPagina: 0 };

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros, {
    maximo: LISTA_MAXIMO,
    porPaginaPadrao: 20,
  });

  const where = { ...escopo, canal: filtros.canal || 'sistema' };

  if (filtros.lida === true) where.lida_em = { [Op.ne]: null };
  if (filtros.lida === false) where.lida_em = null;
  if (filtros.tipo) where.tipo = filtros.tipo;

  const { rows, count } = await db.Notificacao.findAndCountAll({
    where,
    attributes: ATRIBUTOS,
    /* casa com o índice (usuario_id, lida_em); o desempate por id evita que
       duas notificações do mesmo milissegundo troquem de lugar entre páginas */
    order: [['criado_em', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
  });

  /* quem lista com escopo `todas` é painel administrativo e precisa saber de
     quem é cada linha; o dono não precisa do próprio id repetido 20 vezes */
  const paraJson =
    escopoDe(contexto, 'notificacao.ler') === 'todos' ? mapper.comDestinatario : mapper.notificacao;

  return { itens: rows.map(paraJson), total: count, pagina, porPagina };
}

module.exports = { listar };
