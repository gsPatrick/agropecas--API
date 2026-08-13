'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const { pode, escopoDe, filtroDeEscopo } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { lerPaginacao } = require('../../utils/paginacao');
const acessoService = require('./usuario.acesso.service');
const { CAMPOS_LISTA, CAMPOS_DETALHE } = require('./usuario.constants');

/**
 * Leitura de conta — listagem de moderação e ficha individual.
 *
 * É o arquivo onde escopo e LGPD se encontram: toda leitura de dado pessoal
 * de terceiro passa por aqui e, passando, deixa rastro em `logs_acesso_dado`.
 */

/** papéis sem N+1: um único JOIN, sem os campos da tabela de ligação */
const INCLUIR_PAPEIS = {
  model: db.Papel,
  as: 'papeis',
  through: { attributes: [] },
  attributes: ['id', 'chave', 'nome', 'sistema'],
};

/**
 * Carrega o alvo aplicando escopo.
 *
 * **Sempre 404, nunca 403**, quando o registro não é do solicitante: se
 * "existe mas você não pode" respondesse diferente de "não existe", o
 * endpoint viraria consulta de base de usuários — bastaria varrer UUIDs e
 * anotar quais devolvem 403. Ver PADRÃO_MODULO §11.5.
 */
async function carregarAlvo(contexto, id, acao = 'usuario.ler', { comPapeis = true } = {}) {
  const usuario = await db.Usuario.findByPk(id, {
    include: comPapeis ? [INCLUIR_PAPEIS] : [],
  });

  if (!usuario) throw erros.naoEncontrado('Usuário');
  if (!pode(contexto, acao, { donoId: usuario.id })) throw erros.naoEncontrado('Usuário');

  return usuario;
}

/**
 * Listagem de moderação/suporte.
 *
 * Exige escopo `todos` de propósito. Quem tem só `usuario.ler.proprio`
 * receberia uma lista de um item — uma tela inútil que ainda por cima sugere
 * que a listagem "quase funciona". Para ver a si mesmo existe `GET /eu`.
 */
async function listar(contexto, filtros = {}) {
  const escopo = escopoDe(contexto, 'usuario.ler');
  if (escopo !== 'todos') {
    throw erros.semPermissao('Você não tem permissão para listar usuários.', {
      permissao: 'usuario.ler.todos',
    });
  }

  /* o filtro entra na CONSULTA. Buscar tudo e recortar depois mandaria a base
     inteira pela rede antes do descarte */
  const where = { ...filtroDeEscopo(contexto, 'usuario.ler', 'id') };

  if (filtros.status) where.status = filtros.status;

  if (filtros.busca) {
    const termo = `%${filtros.busca.trim()}%`;
    where[Op.or] = [{ nome: { [Op.iLike]: termo } }, { email: { [Op.iLike]: termo } }];
  }

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros);

  const include = [{ ...INCLUIR_PAPEIS }];
  if (filtros.papel) {
    include[0] = { ...INCLUIR_PAPEIS, where: { chave: filtros.papel }, required: true };
  }

  const { rows, count } = await db.Usuario.findAndCountAll({
    where,
    /* lista branca: `observacoes_internas` é TEXT interno e não tem por que
       atravessar a rede numa tela de listagem */
    attributes: CAMPOS_LISTA,
    include,
    /* com JOIN N:N a contagem duplicaria por papel do usuário */
    distinct: true,
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  /* LGPD: quem abriu a lista viu cadastro de terceiro. Em lote, fora do
     caminho crítico de cada linha */
  await acessoService.registrarLeituraEmLote(
    contexto,
    rows.map((linha) => linha.id),
    { motivo: filtros.busca ? `listagem — busca: ${filtros.busca}` : 'listagem de usuários' }
  );

  return { itens: rows, pagina, porPagina, total: count };
}

/** ficha individual; leitura de terceiro gera log de acesso a dado pessoal */
async function ver(contexto, id, { motivo } = {}) {
  const usuario = await db.Usuario.findByPk(id, {
    attributes: CAMPOS_DETALHE,
    include: [INCLUIR_PAPEIS],
  });

  if (!usuario) throw erros.naoEncontrado('Usuário');
  if (!pode(contexto, 'usuario.ler', { donoId: usuario.id })) throw erros.naoEncontrado('Usuário');

  await acessoService.registrarLeitura(contexto, {
    titularId: usuario.id,
    motivo: motivo || 'consulta de cadastro',
  });

  return usuario;
}

/** o titular vendo a si mesmo — sem log de acesso, porque não há terceiro */
const meusDados = (contexto) =>
  db.Usuario.findByPk(contexto.usuarioId, {
    attributes: CAMPOS_DETALHE,
    include: [INCLUIR_PAPEIS],
  });

module.exports = { listar, ver, meusDados, carregarAlvo, INCLUIR_PAPEIS };
