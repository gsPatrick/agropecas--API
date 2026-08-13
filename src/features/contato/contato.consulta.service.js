'use strict';

const db = require('../../models');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { lerPaginacao } = require('../../utils/paginacao');

/**
 * "Quem me chamou" — a lista de contatos recebidos num anúncio.
 *
 * Separado das métricas porque são perguntas diferentes: aqui a resposta é
 * nominal e cai sob LGPD; lá é agregada e não identifica ninguém.
 */

/**
 * Confere o dono e devolve o anúncio.
 *
 * A capacidade é `anuncio.ver_contatos`, verificada com o dono em mãos — o
 * middleware da rota não teria como fazer isso, porque o dono só é conhecido
 * depois da consulta.
 *
 * 404 antes do 403: quem pede um anúncio que não existe e quem pede o anúncio
 * de outra pessoa recebem respostas diferentes de propósito? **Não.** Ambos
 * caem em 403 quando o anúncio existe e não é seu, e em 404 quando não existe
 * — o que não vaza nada, porque o anúncio é público por natureza. Se algum dia
 * rascunho passar por aqui, esta ordem precisa ser revista.
 */
async function exigirDono(contexto, anuncioId, acao = 'anuncio.ver_contatos') {
  const anuncio = await db.Anuncio.findByPk(anuncioId, {
    attributes: ['id', 'usuario_id', 'perfil_id', 'titulo', 'codigo'],
  });
  if (!anuncio) throw erros.naoEncontrado('Anúncio');

  exigir(contexto, acao, { donoId: anuncio.usuario_id });
  return anuncio;
}

/**
 * Lista os contatos recebidos: quem, quando, por qual canal.
 *
 * O `include` do interessado traz nome e nada mais. Não traz telefone nem
 * e-mail: o anunciante recebeu uma intenção de contato, não um cadastro. Quem
 * quiser falar de volta usa o chat interno, que é onde a conversa fica
 * registrada e moderável — expor o telefone de quem clicou seria inverter a
 * regra de consentimento que este módulo inteiro existe para respeitar.
 *
 * Contato anônimo (visitante clicando no WhatsApp) aparece com `interessado`
 * nulo. É informação real: o anunciante precisa saber que houve interesse, e
 * fingir que só existe o contato identificado esconderia metade do movimento.
 */
async function listarRecebidos(contexto, anuncioId, filtros = {}) {
  await exigirDono(contexto, anuncioId);

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros);

  const onde = { anuncio_id: anuncioId };
  if (filtros.canal) onde.canal = filtros.canal;
  if (filtros.desde || filtros.ate) {
    onde.criado_em = {};
    if (filtros.desde) onde.criado_em[db.Sequelize.Op.gte] = filtros.desde;
    if (filtros.ate) onde.criado_em[db.Sequelize.Op.lte] = filtros.ate;
  }

  const { rows, count } = await db.AnuncioContato.findAndCountAll({
    where: onde,
    attributes: ['id', 'canal', 'origem', 'interessado_id', 'conversa_id', 'criado_em'],
    include: [
      {
        model: db.Usuario,
        as: 'interessado',
        required: false,
        attributes: ['id', 'nome'],
      },
    ],
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

/**
 * Contatos recebidos em TODOS os meus anúncios.
 *
 * A tela "meus contatos" do anunciante. Filtra por `anunciante_id`, que é
 * coluna indexada da própria tabela — o caminho alternativo (buscar meus
 * anúncios e depois `IN (...)`) seria duas consultas e quebraria quando
 * alguém tivesse mais anúncios do que cabe num `IN`.
 */
async function listarMeus(contexto, filtros = {}) {
  exigir(contexto, 'anuncio.ver_contatos', { donoId: contexto.usuarioId });

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros);

  const onde = { anunciante_id: contexto.usuarioId };
  if (filtros.canal) onde.canal = filtros.canal;

  const { rows, count } = await db.AnuncioContato.findAndCountAll({
    where: onde,
    attributes: ['id', 'anuncio_id', 'canal', 'origem', 'interessado_id', 'criado_em'],
    include: [
      { model: db.Usuario, as: 'interessado', required: false, attributes: ['id', 'nome'] },
      { model: db.Anuncio, as: 'anuncio', required: true, attributes: ['id', 'titulo', 'slug', 'codigo'] },
    ],
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

module.exports = { listarRecebidos, listarMeus, exigirDono };
