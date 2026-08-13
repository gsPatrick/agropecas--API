'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const { erros } = require('../../utils/erros');
const { lerPaginacao } = require('../../utils/paginacao');
const { exigir } = require('../../rbac');
const {
  JANELA_PADRAO_DIAS,
  JANELA_MAXIMA_DIAS,
  POR_PAGINA_MAXIMO,
  FILTROS_PROIBIDOS,
} = require('./auditoria.constants');

/**
 * Consulta da trilha.
 *
 * SÓ LEITURA — de propósito. Não existe `atualizar` nem `remover` neste
 * módulo, nem para o Admin: uma trilha que o auditado pode editar não prova
 * nada, e a única forma de garantir isso é não escrever a função. O expurgo
 * por prazo de retenção é feito pelo job de LGPD, sem alvo escolhido a dedo.
 */

/** só as colunas que a tela usa — `antes`/`depois` são JSONB e pesam */
const COLUNAS_LISTA = [
  'id',
  'ator_id',
  'ator_papel',
  'em_nome_de',
  'acao',
  'entidade',
  'entidade_id',
  'motivo',
  'origem',
  'criado_em',
];

/** o detalhe traz o diff; é uma linha por vez, então pode */
const COLUNAS_DETALHE = [...COLUNAS_LISTA, 'antes', 'depois', 'user_agent'];

/**
 * Resolve o período com teto.
 *
 * O período é obrigatório na prática (há padrão, não há "sem filtro"): sem
 * recorte, a consulta ignora o índice de `criado_em` e varre a tabela inteira
 * — exatamente durante uma apuração de incidente, quando o banco lento custa
 * mais caro.
 */
function janela({ de, ate } = {}) {
  const fim = ate ? new Date(ate) : new Date();
  const inicioPadrao = new Date(fim.getTime() - JANELA_PADRAO_DIAS * 24 * 60 * 60 * 1000);
  const inicio = de ? new Date(de) : inicioPadrao;

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
    throw erros.invalido('Período inválido.', { code: 'PERIODO_INVALIDO' });
  }
  if (inicio > fim) throw erros.invalido('A data inicial é posterior à final.');

  const dias = (fim - inicio) / (24 * 60 * 60 * 1000);
  if (dias > JANELA_MAXIMA_DIAS) {
    throw erros.invalido(
      `A consulta cobre no máximo ${JANELA_MAXIMA_DIAS} dias. Para períodos maiores, use a exportação.`,
      { code: 'JANELA_EXCEDIDA', maximoDias: JANELA_MAXIMA_DIAS }
    );
  }

  return { inicio, fim };
}

/**
 * Recusa qualquer tentativa de filtrar POR EXCLUSÃO.
 *
 * Filtrar *por* um ator é o uso legítimo ("quem apagou este anúncio?").
 * Filtrar *tirando* um ator é o uso ilegítimo: é como um administrador
 * removeria as próprias linhas do relatório que vai entregar. A recusa é
 * explícita (422) em vez de silenciosa para que a tentativa fique registrada
 * no log da requisição.
 */
function recusarFiltroDeExclusao(consultaBruta = {}) {
  const encontrado = FILTROS_PROIBIDOS.find((chave) => consultaBruta[chave] !== undefined);
  if (!encontrado) return;

  throw erros.validacao({
    [encontrado]:
      'A trilha de auditoria não pode ser filtrada por exclusão de ator. ' +
      'Uma trilha que o auditado consegue estreitar não serve como prova.',
  });
}

/** monta o `where` a partir dos filtros já validados */
function montarWhere(filtros) {
  const { inicio, fim } = janela(filtros);
  const where = { criado_em: { [Op.between]: [inicio, fim] } };

  if (filtros.atorId) where.ator_id = filtros.atorId;
  if (filtros.acao) where.acao = filtros.acao;
  if (filtros.entidade) where.entidade = filtros.entidade;
  if (filtros.entidadeId) where.entidade_id = filtros.entidadeId;
  if (filtros.emNomeDe) where.em_nome_de = filtros.emNomeDe;

  return { where, periodo: { inicio, fim } };
}

/**
 * Trilha paginada.
 *
 * @param consultaBruta  `req.query` ANTES da validação — é onde os parâmetros
 *                       de exclusão apareceriam, já que o validador descarta
 *                       campo desconhecido em silêncio
 */
async function listar(contexto, filtros = {}, consultaBruta = {}) {
  exigir(contexto, 'auditoria.ler');
  recusarFiltroDeExclusao(consultaBruta);

  const { where, periodo } = montarWhere(filtros);
  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros, { maximo: POR_PAGINA_MAXIMO });

  const { rows, count } = await db.LogAuditoria.findAndCountAll({
    where,
    attributes: COLUNAS_LISTA,
    include: [{ model: db.Usuario, as: 'ator', attributes: ['id', 'nome'], required: false }],
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  return { itens: rows, pagina, porPagina, total: count, periodo };
}

/** uma linha com o diff — usada pelo detalhe do painel */
async function obter(contexto, id) {
  exigir(contexto, 'auditoria.ler');

  const registro = await db.LogAuditoria.findByPk(id, {
    attributes: COLUNAS_DETALHE,
    include: [{ model: db.Usuario, as: 'ator', attributes: ['id', 'nome'], required: false }],
  });

  if (!registro) throw erros.naoEncontrado('Registro de auditoria');
  return registro;
}

/**
 * Histórico completo de uma entidade — "tudo que já aconteceu com este
 * anúncio". Bate no índice `(entidade, entidade_id)`, por isso aqui a janela
 * de tempo é opcional: o recorte já é seletivo o bastante.
 */
async function daEntidade(contexto, { entidade, entidadeId }, filtros = {}) {
  exigir(contexto, 'auditoria.ler');

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros, { maximo: POR_PAGINA_MAXIMO });

  const { rows, count } = await db.LogAuditoria.findAndCountAll({
    where: { entidade, entidade_id: entidadeId },
    attributes: COLUNAS_DETALHE,
    include: [{ model: db.Usuario, as: 'ator', attributes: ['id', 'nome'], required: false }],
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

/**
 * Quem LEU dado pessoal deste titular. É o relatório que responde ao titular
 * quando ele pergunta "quem da plataforma abriu meus dados?" — pergunta que a
 * trilha de alteração não responde.
 */
async function acessosAoTitular(contexto, { titularId, atorId } = {}, filtros = {}) {
  exigir(contexto, 'auditoria.ler');

  /* mesma recusa da trilha: `logs_acesso_dado` é o registro de quem LEU dado
     pessoal, e quem está sendo auditado não pode filtrar as próprias linhas
     para fora. A checagem faltava aqui — a trilha estava protegida e esta
     tabela, que é a que responde ao titular pelo art. 18, não */
  recusarFiltroDeExclusao(filtros);

  const where = {};
  if (titularId) where.titular_id = titularId;
  if (atorId) where.ator_id = atorId;

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros, { maximo: POR_PAGINA_MAXIMO });

  const { rows, count } = await db.LogAcessoDado.findAndCountAll({
    where,
    attributes: ['id', 'ator_id', 'titular_id', 'recurso', 'recurso_id', 'motivo', 'denuncia_id', 'criado_em'],
    include: [{ model: db.Usuario, as: 'ator', attributes: ['id', 'nome'], required: false }],
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

module.exports = {
  listar,
  obter,
  daEntidade,
  acessosAoTitular,
  montarWhere,
  janela,
  recusarFiltroDeExclusao,
  COLUNAS_LISTA,
  COLUNAS_DETALHE,
};
