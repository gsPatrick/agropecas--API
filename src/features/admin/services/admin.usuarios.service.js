'use strict';

const { Op } = require('sequelize');
const db = require('../../../models');
const consultaService = require('../../usuario/usuario.consulta.service');
const acessoService = require('../../usuario/usuario.acesso.service');
const { CAMPOS_LISTA } = require('../../usuario/usuario.constants');
const { lerFiltros } = require('../helpers/admin.consulta.helper');
const compartilhado = require('./admin.shared');

/**
 * Leitura de conta pela tela do Admin.
 *
 * Por que não usar `usuario.consulta.service.listar` direto: aquela listagem
 * responde à pergunta da feature ("quais contas existem, com que status"). A
 * do painel responde à pergunta da TAREFA — «achar a loja de Sorriso que
 * abriu chamado» —, e para isso precisa cruzar conta com perfil, buscar por
 * documento e filtrar por tipo de perfil e UF. Fazer a feature `usuario`
 * conhecer `perfil` para atender essa tela seria pagar acoplamento
 * permanente por uma necessidade que só existe aqui.
 *
 * O que NÃO é reimplementado: o registro de acesso a dado pessoal continua
 * sendo `usuario.acesso.service`, e a ficha individual continua sendo
 * `usuario.consulta.service.ver` — inclusive porque é ela que grava o log.
 *
 * **Toda leitura desta tela deixa rastro em `logs_acesso_dado`.** Não é
 * cerimônia: quando um moderador abre o cadastro de alguém, nada muda no
 * banco, e a leitura é justamente o que a LGPD cobra prestação de contas.
 */

/** papéis num JOIN só — buscar em laço multiplicaria a página por vinte */
const INCLUIR_PAPEIS = {
  model: db.Papel,
  as: 'papeis',
  through: { attributes: [] },
  attributes: ['id', 'chave', 'nome', 'sistema'],
};

/** o perfil da listagem: só o que o card mostra, nada de `bio` (TEXT) */
const CAMPOS_PERFIL_LISTA = [
  'id',
  'usuario_id',
  'tipo',
  'slug',
  'nome_exibicao',
  'uf',
  'documento',
  'documento_tipo',
  'verificado_em',
  'total_anuncios_ativos',
];

/**
 * Linha da listagem administrativa.
 *
 * Lista branca explícita, como manda o §6 do padrão — e com uma trava a mais:
 * `documento` só entra quando o chamador provou ter escopo total em
 * `lgpd.acessar_dado_pessoal`. Deixar a decisão no controller faria o dado
 * depender de alguém lembrar de um `if`.
 */
const perfilResumido = (perfil, { comDocumento = false } = {}) =>
  perfil
    ? {
        id: perfil.id,
        tipo: perfil.tipo,
        slug: perfil.slug,
        nomeExibicao: perfil.nome_exibicao,
        uf: perfil.uf,
        verificado: Boolean(perfil.verificado_em),
        totalAnunciosAtivos: perfil.total_anuncios_ativos,
        documentoTipo: perfil.documento_tipo,
        ...(comDocumento ? { documento: perfil.documento } : {}),
      }
    : null;

const linha = (registro, { comDocumento = false } = {}) => ({
  id: registro.id,
  nome: registro.nome,
  email: registro.email,
  status: registro.status,
  suspensoAte: registro.suspenso_ate,
  emailVerificado: Boolean(registro.email_verificado_em),
  ultimoLoginEm: registro.ultimo_login_em,
  anonimizado: Boolean(registro.anonimizado_em),
  criadoEm: registro.criado_em,
  papeis: (registro.papeis || []).map((papel) => papel.chave),
  perfil: perfilResumido(registro.perfil, { comDocumento }),
});

const ORDENAVEIS = ['criado_em', 'ultimo_login_em', 'nome', 'status'];

/**
 * Listagem com busca e filtros.
 *
 * A busca por documento só é aplicada para quem pode ver documento — não por
 * elegância, mas porque uma busca por CPF que devolve resultado é uma consulta
 * de CPF, tenha ou não a coluna na resposta.
 */
async function listar(contexto, query = {}) {
  compartilhado.exigirEscopoTotal(
    contexto,
    'usuario.ler',
    'Você não tem permissão para listar usuários.'
  );

  const cap = compartilhado.capacidades(contexto);
  const filtros = lerFiltros(query, { camposOrdenacao: ORDENAVEIS, ordemPadrao: 'criado_em' });

  const where = {};
  if (query.status) where.status = query.status;
  if (filtros.periodo) {
    where.criado_em = { [Op.gte]: filtros.periodo.inicio, [Op.lte]: filtros.periodo.fim };
  }

  /* o filtro entra na CONSULTA. Buscar tudo e recortar na aplicação mandaria a
     base inteira pela rede antes do descarte */
  const perfilWhere = {};
  if (query.tipoPerfil) perfilWhere.tipo = query.tipoPerfil;
  if (query.uf) perfilWhere.uf = String(query.uf).toUpperCase();
  if (query.verificado === true) perfilWhere.verificado_em = { [Op.ne]: null };
  if (query.verificado === false) perfilWhere.verificado_em = null;

  const filtraPorPerfil = Object.keys(perfilWhere).length > 0;

  const include = [
    { ...INCLUIR_PAPEIS, ...(query.papel ? { where: { chave: query.papel }, required: true } : {}) },
    {
      model: db.Perfil,
      as: 'perfil',
      attributes: CAMPOS_PERFIL_LISTA,
      required: filtraPorPerfil,
      ...(filtraPorPerfil ? { where: perfilWhere } : {}),
    },
  ];

  if (filtros.busca) {
    const termo = `%${filtros.busca}%`;
    const alternativas = [{ nome: { [Op.iLike]: termo } }, { email: { [Op.iLike]: termo } }];

    /* o termo só é tratado como documento quando NÃO tem letra: um e-mail como
       `joao1990@…` tem dígitos suficientes para parecer um CPF, e tratá-lo
       assim fazia a busca por e-mail devolver vazio — "o usuário não existe"
       para uma conta que existe é o pior resultado de uma tela de suporte */
    const digitos = filtros.busca.replace(/\D/g, '');
    const pareceDocumento = /^[\d.\-/\s]+$/.test(filtros.busca) && [11, 14].includes(digitos.length);

    if (cap.documento && pareceDocumento) {
      /* documento é guardado só com dígitos; procurar pelo texto formatado
         nunca encontraria nada. `$perfil.documento$` põe a condição no `WHERE`
         do JOIN já existente, sem uma segunda consulta */
      alternativas.push({ '$perfil.documento$': digitos });
    }

    where[Op.or] = alternativas;
  }

  const { rows, count } = await db.Usuario.findAndCountAll({
    where,
    /* lista branca de colunas: `observacoes_internas` é TEXT de uso interno e
       não tem por que atravessar a rede em toda página */
    attributes: CAMPOS_LISTA,
    include,
    /* com JOIN N:N a contagem duplicaria uma vez por papel do usuário */
    distinct: true,
    subQuery: false,
    order: filtros.ordem,
    offset: filtros.offset,
    limit: filtros.limit,
  });

  /* LGPD em lote, fora do caminho crítico de cada linha: uma página de 25
     cadastros não pode virar 25 INSERTs em sequência */
  await acessoService.registrarLeituraEmLote(
    contexto,
    rows.map((registro) => registro.id),
    {
      motivo: filtros.busca
        ? `painel — listagem de usuários (busca: ${filtros.busca})`
        : 'painel — listagem de usuários',
    }
  );

  return {
    itens: rows.map((registro) => linha(registro, { comDocumento: cap.documento })),
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    total: count,
  };
}

/**
 * Ficha completa.
 *
 * `usuario.consulta.service.ver` faz o trabalho de sempre — escopo, 404
 * indistinguível de 403 e registro em `logs_acesso_dado`. O que o painel
 * acrescenta são os números que a tela de atendimento pede junto (anúncios,
 * denúncias, sessões abertas), buscados em paralelo e por agregação, nunca em
 * laço.
 */
async function ver(contexto, id) {
  const usuario = await consultaService.ver(contexto, id, { motivo: 'painel — ficha do usuário' });
  const cap = compartilhado.capacidades(contexto);

  const [perfil, anuncios, denunciasRecebidas, sessoesAtivas, assinatura] = await Promise.all([
    db.Perfil.findOne({ where: { usuario_id: id }, attributes: CAMPOS_PERFIL_LISTA }),
    db.Anuncio.count({ where: { usuario_id: id } }),
    db.Denuncia.count({ where: { denunciado_id: id } }),
    db.Sessao.count({ where: { usuario_id: id, revogada_em: null, expira_em: { [Op.gt]: new Date() } } }),
    db.Assinatura.findOne({
      where: { usuario_id: id, status: 'ativa' },
      attributes: ['id', 'status', 'plano_id'],
      include: [{ model: db.Plano, as: 'plano', attributes: ['id', 'nome'], required: false }],
    }),
  ]);

  /* documento é uma segunda leitura de dado pessoal, mais sensível que o
     cadastro: ela ganha linha própria em `logs_acesso_dado` para que a
     apuração consiga responder "quem consultou o CPF de fulano" */
  if (cap.documento && perfil?.documento) {
    await acessoService.registrarLeitura(contexto, {
      titularId: id,
      recurso: 'documento',
      recursoId: perfil.id,
      motivo: 'painel — ficha do usuário',
    });
  }

  return {
    usuario,
    perfil: perfilResumido(perfil, { comDocumento: cap.documento }),
    contadores: {
      anuncios,
      denunciasRecebidas,
      sessoesAtivas,
    },
    plano: assinatura?.plano ? { id: assinatura.plano.id, nome: assinatura.plano.nome } : null,
  };
}

/**
 * O que esta pessoa fez e o que fizeram com ela.
 *
 * Duas perguntas em uma tela, porque no atendimento elas nunca vêm separadas:
 * `ator_id` responde "o que ele fez" e `em_nome_de` + `entidade_id` respondem
 * "o que fizeram na conta dele". Um `OR` só, resolvido pelo índice de
 * `criado_em`.
 */
async function atividade(contexto, id, query = {}) {
  compartilhado.exigirEscopoTotal(
    contexto,
    'usuario.ler',
    'Você não tem permissão para ver a atividade de outra conta.'
  );

  const filtros = lerFiltros(query, { camposOrdenacao: ['criado_em'], ordemPadrao: 'criado_em' });

  const where = {
    [Op.or]: [{ ator_id: id }, { em_nome_de: id }, { entidade: 'usuarios', entidade_id: id }],
  };
  if (filtros.periodo) {
    where.criado_em = { [Op.gte]: filtros.periodo.inicio, [Op.lte]: filtros.periodo.fim };
  }

  const { rows, count } = await db.LogAuditoria.findAndCountAll({
    where,
    /* `antes`/`depois` são JSONB e pesam; a linha do tempo não os usa */
    attributes: ['id', 'acao', 'entidade', 'entidade_id', 'ator_id', 'em_nome_de', 'motivo', 'origem', 'criado_em'],
    order: [['criado_em', 'DESC']],
    offset: filtros.offset,
    limit: filtros.limit,
  });

  await acessoService.registrarLeitura(contexto, {
    titularId: id,
    motivo: 'painel — atividade da conta',
  });

  return { itens: rows, pagina: filtros.pagina, porPagina: filtros.porPagina, total: count };
}

module.exports = {
  listar,
  ver,
  atividade,
  linha,
  perfilResumido,
  INCLUIR_PAPEIS,
  CAMPOS_PERFIL_LISTA,
};
