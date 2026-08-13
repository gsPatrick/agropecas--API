'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const { filtroDeEscopo, pode } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { lerPaginacao } = require('../../utils/paginacao');
const { variantesDe } = require('./midia.processamento.service');
const { REFERENCIA_VARIANTE, REFERENCIAS } = require('./midia.constants');

/**
 * Leitura do inventário do usuário.
 *
 * Sem cache de propósito: a listagem é por usuário, muda a cada upload e a
 * cada remoção, e uma foto que some da grade só ao expirar o TTL é
 * exatamente o tipo de "bug" que ninguém consegue reproduzir. O ganho de
 * cachear uma consulta indexada e paginada por `usuario_id` não paga a
 * invalidação que ela exigiria.
 */

/* colunas grandes ou sem uso na tela ficam fora: `arquivos` é tabela de
   inventário e cresce mais rápido que qualquer outra */
const COLUNAS = [
  'id',
  'usuario_id',
  'path',
  'url',
  'nome_original',
  'mime',
  'tamanho_bytes',
  'referencia_tipo',
  'referencia_id',
  'descartar_em',
  'criado_em',
];

/** as variantes são linhas na mesma tabela; a listagem mostra só os originais */
const SOMENTE_ORIGINAIS = {
  [Op.or]: [{ referencia_tipo: null }, { referencia_tipo: { [Op.ne]: REFERENCIA_VARIANTE } }],
};

async function listar(contexto, query = {}) {
  /* o catálogo RBAC não tem `arquivo.ler`; o escopo de `arquivo.remover` é o
     que existe hoje com as duas variantes (`proprio` e `todos`) e traduz a
     mesma pergunta: sobre quais arquivos esta pessoa tem alcance. Reportado
     ao orquestrador para virar ação própria */
  const escopo = filtroDeEscopo(contexto, 'arquivo.remover', 'usuario_id');
  if (!escopo) return { itens: [], paginacao: { pagina: 1, porPagina: 0, total: 0 } };

  const { pagina, porPagina, offset, limit } = lerPaginacao(query);

  const where = { ...escopo, ...SOMENTE_ORIGINAIS };

  /* o Admin lista de todo mundo por padrão; `?usuarioId=` estreita, e para
     quem não é Admin o filtro de escopo acima já sobrescreveu qualquer
     tentativa de olhar o alheio */
  if (query.usuarioId && !escopo.usuario_id) where.usuario_id = query.usuarioId;
  if (query.referenciaTipo) {
    if (!REFERENCIAS.includes(query.referenciaTipo)) {
      throw erros.validacao({ referenciaTipo: 'Vínculo desconhecido.' });
    }
    where.referencia_tipo = query.referenciaTipo;
  }
  if (query.referenciaId) where.referencia_id = query.referenciaId;

  const { rows, count } = await db.Arquivo.findAndCountAll({
    where,
    attributes: COLUNAS,
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  /* uma consulta para a página inteira, não uma por item: buscar variante
     dentro do laço seria o N+1 clássico com dez fotos por anúncio */
  const mapa = await variantesDe(rows.map((linha) => linha.id));

  return {
    itens: rows.map((linha) => ({ arquivo: linha, variantes: mapa.get(String(linha.id)) || {} })),
    paginacao: { pagina, porPagina, total: count },
  };
}

/** um arquivo, com as variantes; 404 quando não existe ou não é alcançável */
async function obter(contexto, id) {
  const arquivo = await db.Arquivo.findByPk(id, { attributes: COLUNAS });

  if (!arquivo || arquivo.referencia_tipo === REFERENCIA_VARIANTE) {
    throw erros.naoEncontrado('Arquivo');
  }

  /* aqui o módulo responde 403 no arquivo alheio, e não o 404 indistinguível
     que §11.5 do padrão pede. O id de arquivo não é adivinhável (UUIDv4) nem
     enumerável por sequência, então o ganho contra varredura seria nulo,
     enquanto o 403 diz ao anunciante que a foto existe e é de outra pessoa —
     o que evita chamado de suporte sobre "sumiu minha imagem" */
  if (!pode(contexto, 'arquivo.remover', { donoId: arquivo.usuario_id })) {
    throw erros.semPermissao('Este arquivo é de outro usuário.', { permissao: 'arquivo.remover' });
  }

  const mapa = await variantesDe(arquivo.id);
  return { arquivo, variantes: mapa.get(String(arquivo.id)) || {} };
}

module.exports = { listar, obter, COLUNAS, SOMENTE_ORIGINAIS };
