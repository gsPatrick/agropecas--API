'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const acesso = require('./conversa.acesso.service');
const { MENSAGENS_POR_PAGINA, MENSAGENS_POR_PAGINA_MAXIMO } = require('./conversa.constants');

/**
 * Histórico por CURSOR, do mais recente para o mais antigo.
 *
 * Offset não serve para chat: entre carregar a página 1 e pedir a página 2,
 * uma mensagem nova entra no topo, tudo desce uma posição e a primeira
 * mensagem da página 2 é a que o usuário já tinha lido — a anterior a ela some
 * da tela para sempre. O cursor aponta para uma LINHA, não para uma posição,
 * então inserção concorrente não desloca nada.
 *
 * O cursor é composto (`criado_em` + `id`): duas mensagens no mesmo
 * milissegundo — o mesmo envio duplicado por retry, por exemplo — empatariam
 * com cursor só de data e uma delas se perderia na virada de página.
 */
async function mensagens(contexto, conversaId, { antesDe, limite } = {}) {
  await acesso.exigirParticipacao(contexto, conversaId, 'conversa.ler', {
    permitirModeracao: true,
  });

  const tamanho = Math.min(
    Math.max(1, limite || MENSAGENS_POR_PAGINA),
    MENSAGENS_POR_PAGINA_MAXIMO
  );

  const where = { conversa_id: conversaId };
  const cursor = decodificarCursor(antesDe);

  if (cursor) {
    where[Op.or] = [
      { criado_em: { [Op.lt]: cursor.data } },
      { criado_em: cursor.data, id: { [Op.lt]: cursor.id } },
    ];
  }

  /* pede uma a mais para saber se existe próxima página sem um COUNT extra */
  const linhas = await db.Mensagem.findAll({
    where,
    attributes: [
      'id',
      'conversa_id',
      'remetente_id',
      'tipo',
      'conteudo',
      'anexo_url',
      'anexo_mime',
      'editada_em',
      'removida_em',
      'lida_em',
      'criado_em',
    ],
    order: [
      ['criado_em', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: tamanho + 1,
  });

  const temMais = linhas.length > tamanho;
  const itens = temMais ? linhas.slice(0, tamanho) : linhas;
  const ultima = itens[itens.length - 1];

  return {
    itens,
    proximoCursor: temMais && ultima ? codificarCursor(ultima) : null,
  };
}

/* o cursor é opaco de propósito: expor `criado_em` cru convidaria o cliente a
   montar o valor na mão, e aí mudar a ordenação viraria mudança de contrato */
const codificarCursor = (mensagem) =>
  Buffer.from(`${new Date(mensagem.criado_em).toISOString()}|${mensagem.id}`).toString('base64url');

function decodificarCursor(valor) {
  if (!valor) return null;

  try {
    const [data, id] = Buffer.from(valor, 'base64url').toString('utf8').split('|');
    const quando = new Date(data);

    /* cursor corrompido devolve a primeira página em vez de 500: paginação
       quebrada não é falha do servidor, e um erro aqui viraria tela branca */
    if (Number.isNaN(quando.getTime()) || !id) return null;
    return { data: quando, id };
  } catch (erro) {
    return null;
  }
}


module.exports = { mensagens, codificarCursor, decodificarCursor };
