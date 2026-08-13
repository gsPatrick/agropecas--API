'use strict';

const { erros } = require('../utils/erros');

const { CORINGA } = require('./permissoes');

/**
 * Motor de autorização — funções puras, sem Express e sem Sequelize.
 *
 * As features consomem só isto. Nenhum service deve escrever
 * `if (usuario.papel === 'admin')`: essa comparação espalhada pelo código é o
 * que impede criar papel novo sem caçar `if` pelo projeto inteiro.
 *
 * DUAS DIMENSÕES, sempre:
 *   1. capacidade — pode executar esta ação?
 *   2. escopo     — sobre QUAIS registros? (`proprio` ou `todos`)
 *
 * O escopo NÃO é decorativo: quem tem `anuncio.editar.proprio` e tenta editar
 * anúncio alheio recebe 403. Quem tem `.todos` passa. É o service que aplica o
 * filtro na consulta — nunca o front.
 */

/**
 * Monta o contexto de autorização a partir do usuário carregado com papéis e
 * permissões. Feito uma vez por requisição; `pode()` depois é O(1).
 */
function montarContexto(usuario) {
  if (!usuario) {
    return { autenticado: false, usuarioId: null, papeis: [], permissoes: new Set(), admin: false };
  }

  const papeis = (usuario.papeis || []).map((papel) => papel.chave);
  const permissoes = new Set();

  (usuario.papeis || []).forEach((papel) => {
    (papel.permissoes || []).forEach((permissao) => permissoes.add(permissao.chave));
  });

  return {
    autenticado: true,
    usuarioId: usuario.id,
    papeis,
    permissoes,
    /* o coringa é o poder total do Admin — ver src/rbac/papeis.js */
    admin: permissoes.has(CORINGA) || papeis.includes('admin'),
  };
}

/** o contexto tem esta chave exata? */
function temPermissao(contexto, chave) {
  if (!contexto || !contexto.autenticado) return false;
  if (contexto.admin) return true;
  return contexto.permissoes.has(chave);
}

/**
 * Maior escopo do contexto para uma ação.
 * Retorna 'todos', 'proprio' ou null (não pode).
 */
function escopoDe(contexto, recursoAcao) {
  if (!contexto || !contexto.autenticado) return null;
  if (contexto.admin) return 'todos';

  const variantes = [
    { chave: `${recursoAcao}.todos`, escopo: 'todos' },
    { chave: `${recursoAcao}.todas`, escopo: 'todos' },
    { chave: `${recursoAcao}.proprio`, escopo: 'proprio' },
    { chave: `${recursoAcao}.propria`, escopo: 'proprio' },
    { chave: recursoAcao, escopo: 'todos' }, // ação sem escopo (ex.: anuncio.criar)
  ];

  const encontrada = variantes.find((variante) => contexto.permissoes.has(variante.chave));
  return encontrada ? encontrada.escopo : null;
}

/**
 * Pode executar a ação sobre este registro?
 *
 * @param alvo.donoId  dono do registro; quando informado, `proprio` só passa
 *                     se o dono for o próprio usuário.
 */
function pode(contexto, recursoAcao, alvo = {}) {
  const escopo = escopoDe(contexto, recursoAcao);
  if (!escopo) return false;
  if (escopo === 'todos') return true;
  if (alvo.donoId === undefined || alvo.donoId === null) return true;
  return String(alvo.donoId) === String(contexto.usuarioId);
}

/** Igual a `pode`, mas lança — para uso direto no service. */
function exigir(contexto, recursoAcao, alvo = {}) {
  if (pode(contexto, recursoAcao, alvo)) return true;

  /* AppError e não Error cru: o middleware de erro só traduz AppError, e um
     Error solto com `statusCode` viraria 500 — negação de permissão apareceria
     como falha do servidor */
  throw contexto?.autenticado
    ? erros.semPermissao('Você não tem permissão para esta ação.', { permissao: recursoAcao })
    : erros.naoAutenticado('É preciso estar autenticado.');
}

/**
 * Fragmento de `where` conforme o escopo — para a LISTAGEM.
 *
 * Sem isto, a tentação é filtrar na aplicação depois de buscar tudo, e aí um
 * usuário comum recebe o banco inteiro pela rede antes do filtro.
 *
 * @returns {} para escopo total · { [coluna]: usuarioId } para próprio
 *          · null quando não pode nada (o service deve devolver lista vazia)
 */
function filtroDeEscopo(contexto, recursoAcao, coluna = 'usuario_id') {
  const escopo = escopoDe(contexto, recursoAcao);
  if (!escopo) return null;
  if (escopo === 'todos') return {};
  return { [coluna]: contexto.usuarioId };
}

/** o usuário tem algum destes papéis? (usar só para navegação/UI, não para dados) */
function temPapel(contexto, ...papeis) {
  if (!contexto || !contexto.autenticado) return false;
  return papeis.some((papel) => contexto.papeis.includes(papel));
}

module.exports = {
  montarContexto,
  temPermissao,
  escopoDe,
  pode,
  exigir,
  filtroDeEscopo,
  temPapel,
};
