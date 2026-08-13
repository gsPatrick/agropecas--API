'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const { lerPaginacao } = require('../../utils/paginacao');
const acessoService = require('../usuario/usuario.acesso.service');
const { exigirEscopoTotal } = require('./moderacao.comum');
const { ENTIDADE, RECURSO_ACESSO } = require('./moderacao.constants');

/**
 * "O que foi feito, por quem, quando e por quê."
 *
 * Duas fontes, de propósito:
 *   · `anuncio_historico` — a trilha do ANÚNCIO, que o dono também vê;
 *   · `logs_auditoria`    — a trilha do ATOR, que só a moderação vê.
 *
 * Consultar a segunda para um usuário é abrir informação sobre uma pessoa, e
 * por isso registra `logs_acesso_dado` (LGPD). Consultar a primeira não: ali o
 * titular da informação é o anúncio, não a pessoa.
 */

/** histórico de um anúncio, do mais recente para o mais antigo */
async function doAnuncio(contexto, anuncioId, filtros = {}) {
  exigirEscopoTotal(contexto, 'anuncio.ler');

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros, { porPaginaPadrao: 30, maximo: 100 });

  const { rows, count } = await db.AnuncioHistorico.findAndCountAll({
    where: { anuncio_id: anuncioId },
    /* `ip_hash` fica fora: está na trilha para investigação, não para tela */
    attributes: ['id', 'status_anterior', 'status_novo', 'ator_id', 'ator_papel', 'motivo', 'alteracoes', 'criado_em'],
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

/**
 * Tudo o que a moderação já fez sobre uma conta.
 *
 * Filtra por `entidade = usuarios` + `entidade_id`: as ações de moderação de
 * conta são gravadas assim por `moderacao.comum.js`, então uma consulta só
 * cobre suspensão, banimento e restauração sem precisar de tabela nova.
 */
async function doUsuario(contexto, usuarioId, filtros = {}) {
  exigirEscopoTotal(contexto, 'usuario.ler');

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros, { porPaginaPadrao: 30, maximo: 100 });

  const { rows, count } = await db.LogAuditoria.findAndCountAll({
    where: {
      entidade: ENTIDADE.USUARIO,
      entidade_id: usuarioId,
      acao: { [Op.in]: ['suspender', 'banir', 'restaurar', 'remover', 'ocultar'] },
    },
    attributes: ['id', 'acao', 'ator_id', 'ator_papel', 'antes', 'depois', 'motivo', 'criado_em'],
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  /* abrir a ficha de sanções de alguém é leitura de dado pessoal de terceiro */
  await acessoService.registrarLeitura(contexto, {
    titularId: usuarioId,
    recurso: RECURSO_ACESSO,
    recursoId: usuarioId,
    motivo: 'histórico de moderação da conta',
  });

  return { itens: rows, pagina, porPagina, total: count };
}

module.exports = { doAnuncio, doUsuario };
