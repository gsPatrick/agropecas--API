'use strict';

const { Op } = require('sequelize');
const db = require('../../../models');
const { erros } = require('../../../utils/erros');
const acessoService = require('../../usuario/usuario.acesso.service');
const verificacaoService = require('../../perfil/perfil.verificacao.service');
const { exigirMotivo } = require('../../moderacao/moderacao.comum');
const { lerFiltros } = require('../helpers/admin.consulta.helper');
const compartilhado = require('./admin.shared');

/**
 * Perfis pela mesa do Admin: quem existe, e quem já foi conferido.
 *
 * Por que não reaproveitar `perfil.listagem.service.listar`: aquela é a
 * VITRINE. Ela é cacheada por assinatura de filtro, devolve `mapper.item`
 * (sem documento, sem status da conta) e é servida a visitante sem login — é
 * exatamente o que ela precisa ser. A tela de verificação faz a pergunta
 * oposta: "quem ainda não foi conferido, e quem é o dono disso". Forçar a
 * vitrine a responder isso significaria dar a ela um caminho que devolve
 * documento — e um caminho desses, existindo, um dia é chamado sem a trava.
 *
 * A verificação em si NÃO é reimplementada: `perfil.verificacao.service` é
 * quem escreve `verificado_em`/`verificado_por`, e é ele que garante que os
 * dois valores nunca venham da requisição.
 */

const CAMPOS = [
  'id',
  'usuario_id',
  'tipo',
  'slug',
  'nome_exibicao',
  'uf',
  'municipio_id',
  'documento',
  'documento_tipo',
  'pessoa_tipo',
  'verificado_em',
  'verificado_por',
  'verificacao_observacao',
  'total_anuncios_ativos',
  'criado_em',
];

const ORDENAVEIS = ['criado_em', 'nome_exibicao', 'verificado_em'];

/** lista branca da tela — `documento` só quando o chamador provou poder vê-lo */
const linha = (registro, { comDocumento = false } = {}) => ({
  id: registro.id,
  tipo: registro.tipo,
  slug: registro.slug,
  nomeExibicao: registro.nome_exibicao,
  uf: registro.uf,
  verificado: Boolean(registro.verificado_em),
  verificadoEm: registro.verificado_em,
  verificacaoObservacao: registro.verificacao_observacao,
  totalAnunciosAtivos: registro.total_anuncios_ativos,
  criadoEm: registro.criado_em,
  pessoaTipo: registro.pessoa_tipo,
  documentoTipo: registro.documento_tipo,
  ...(comDocumento ? { documento: registro.documento } : {}),
  usuario: registro.usuario
    ? {
        id: registro.usuario.id,
        nome: registro.usuario.nome,
        email: registro.usuario.email,
        status: registro.usuario.status,
      }
    : null,
});

async function listar(contexto, query = {}) {
  compartilhado.exigirEscopoTotal(
    contexto,
    'perfil.ler',
    'Você não tem permissão para listar perfis.'
  );

  const cap = compartilhado.capacidades(contexto);
  const filtros = lerFiltros(query, { camposOrdenacao: ORDENAVEIS, ordemPadrao: 'criado_em' });

  const where = {};
  if (query.tipo) where.tipo = query.tipo;
  if (query.uf) where.uf = String(query.uf).toUpperCase();
  if (query.verificado === true) where.verificado_em = { [Op.ne]: null };
  if (query.verificado === false) where.verificado_em = null;
  if (filtros.periodo) {
    where.criado_em = { [Op.gte]: filtros.periodo.inicio, [Op.lte]: filtros.periodo.fim };
  }
  if (filtros.busca) where.nome_exibicao = { [Op.iLike]: `%${filtros.busca}%` };

  const { rows, count } = await db.Perfil.findAndCountAll({
    where,
    attributes: CAMPOS,
    /* o dono vem em `include`: uma consulta a mais por linha para mostrar o
       nome de quem cadastrou é o N+1 clássico desta tela */
    include: [
      { model: db.Usuario, as: 'usuario', attributes: ['id', 'nome', 'email', 'status'], required: false },
    ],
    order: filtros.ordem,
    offset: filtros.offset,
    limit: filtros.limit,
    distinct: true,
  });

  /* a tela mostra nome, e-mail e (para quem pode) documento de terceiros —
     é leitura de dado pessoal, e leitura também é evento */
  await acessoService.registrarLeituraEmLote(
    contexto,
    rows.map((registro) => registro.usuario_id),
    { motivo: 'painel — listagem de perfis' }
  );

  return {
    itens: rows.map((registro) => linha(registro, { comDocumento: cap.documento })),
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    total: count,
  };
}

/** carrega o registro cru: o service de verificação recebe a instância */
async function carregar(id) {
  const perfil = await db.Perfil.findByPk(id);
  if (!perfil) throw erros.naoEncontrado('Perfil');
  return perfil;
}

/**
 * Conceder o selo.
 *
 * `perfil.verificacao.service` exige `perfil.verificar` (que só existe com
 * escopo `todos`), grava a auditoria com `em_nome_de` apontando o titular e
 * derruba o cache do perfil. Aqui só sobra derrubar o resumo do painel, que
 * conta perfis aguardando verificação.
 */
async function verificar(contexto, id, { observacao } = {}) {
  const perfil = await verificacaoService.verificar(await carregar(id), { observacao }, contexto);
  await compartilhado.invalidarPainel();
  return perfil;
}

/**
 * Revogar o selo — motivo obrigatório.
 *
 * Tirar a verificação de uma loja é um ato público sobre a reputação dela: é o
 * primeiro item que alguém contesta, e o texto do motivo é a única resposta
 * que o suporte terá. O service de perfil aceita motivo vazio (o dono do
 * assunto tem outros chamadores); a exigência é desta tela.
 */
async function revogar(contexto, id, { motivo } = {}) {
  const justificativa = exigirMotivo(motivo);

  const perfil = await verificacaoService.revogar(await carregar(id), { motivo: justificativa }, contexto);
  await compartilhado.invalidarPainel();
  return perfil;
}

module.exports = { listar, verificar, revogar, linha };
