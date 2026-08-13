'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const acesso = require('./conversa.acesso.service');

/**
 * Caixa de entrada do chat.
 *
 * ### A caixa de entrada é a tela mais aberta do produto
 *
 * Ela roda em **uma consulta** (mais um `COUNT` para a paginação). O caminho
 * ingênuo — listar conversas e, para cada uma, buscar a última mensagem, o
 * contador e o outro usuário — custaria `1 + 3N` idas ao banco, e o app abre
 * essa tela a cada retorno de segundo plano.
 *
 * O que torna a consulta única:
 *
 * - **prévia desnormalizada**: `conversas.ultima_mensagem_previa/_em/_de` são
 *   gravadas no envio, então a lista nunca toca em `mensagens`;
 * - **contador em coluna**: `conversa_participantes.nao_lidas`, mantido com
 *   `increment`/`decrement` atômicos. `COUNT(*)` por conversa a cada abertura
 *   de tela é o clássico que só aparece quando o histórico cresce;
 * - **JOIN em vez de laço**: anúncio e as duas partes vêm por `include`, todos
 *   `belongsTo`/`hasOne`, que o Sequelize resolve com LEFT JOIN sem duplicar
 *   linha.
 *
 * A consulta parte de `conversa_participantes` (não de `conversas`) porque o
 * filtro é sempre "as minhas": o índice `(usuario_id, nao_lidas)` atende esta
 * tela e o balão de não lidas.
 */

/** dados públicos de uma das partes — o mapper ainda filtra o WhatsApp */
const parte = (as) => ({
  model: db.Usuario,
  as,
  attributes: ['id', 'nome'],
  include: [
    {
      model: db.Perfil,
      as: 'perfil',
      attributes: [
        'id',
        'slug',
        'tipo',
        'nome_exibicao',
        'foto_url',
        'verificado_em',
        'whatsapp',
        'exibir_whatsapp',
        'aceita_chat',
      ],
    },
  ],
});

/* `attributes` explícito: `conversas` tem TEXT (`bloqueada_motivo`) que a
   caixa de entrada não usa e que sairia em toda linha da lista */
const CONVERSA = () => ({
  model: db.Conversa,
  as: 'conversa',
  required: true,
  attributes: [
    'id',
    'anuncio_id',
    'anunciante_id',
    'interessado_id',
    'status',
    'ultima_mensagem_em',
    'ultima_mensagem_previa',
    'ultima_mensagem_de',
    'total_mensagens',
    'encerrada_em',
    'criado_em',
  ],
  include: [
    {
      model: db.Anuncio,
      as: 'anuncio',
      attributes: ['id', 'codigo', 'titulo', 'slug', 'status', 'preco_centavos'],
    },
    parte('anunciante'),
    parte('interessado'),
  ],
});

/**
 * Caixa de entrada, paginada e ordenada pela última mensagem.
 *
 * `NULLS LAST` porque conversa recém-aberta ainda não tem mensagem e não pode
 * encabeçar a lista à frente de quem acabou de escrever.
 */
async function listar(contexto, { pagina, porPagina, arquivadas }) {
  const where = { usuario_id: contexto.usuarioId, saiu_em: null };

  where.arquivada_em = arquivadas ? { [Op.ne]: null } : null;

  const { rows, count } = await db.ConversaParticipante.findAndCountAll({
    where,
    include: [CONVERSA()],
    order: [
      db.Sequelize.literal('"conversa"."ultima_mensagem_em" DESC NULLS LAST'),
      db.Sequelize.literal('"conversa"."criado_em" DESC'),
    ],
    limit: porPagina,
    offset: (pagina - 1) * porPagina,
    /* sem subconsulta: todos os includes são para-um, então o LIMIT pode ser
       aplicado direto — e é o que permite ordenar por coluna da conversa */
    subQuery: false,
    distinct: true,
  });

  return { itens: rows, total: count };
}

/** total de não lidas para o balão — soma da coluna, nunca `COUNT` em mensagens */
async function totalNaoLidas(usuarioId) {
  const total = await db.ConversaParticipante.sum('nao_lidas', {
    where: { usuario_id: usuarioId, saiu_em: null, arquivada_em: null },
  });
  return total || 0;
}

/**
 * Cabeçalho da conversa.
 *
 * A participação é conferida antes (`acesso`), e só então os dados são
 * carregados: inverter a ordem faria a consulta cara rodar para quem nem podia
 * abrir a tela.
 */
async function detalhe(contexto, conversaId) {
  const { conversa, moderacao } = await acesso.exigirParticipacao(
    contexto,
    conversaId,
    'conversa.ler',
    { permitirModeracao: true }
  );

  if (moderacao) {
    const completa = await db.Conversa.findByPk(conversa.id, {
      attributes: CONVERSA().attributes,
      include: CONVERSA().include,
    });

    /* a moderação vê a conversa, não o estado pessoal de ninguém: contador e
       arquivamento são de quem participa */
    return {
      participante: {
        papel: 'anunciante',
        nao_lidas: 0,
        arquivada_em: null,
        silenciada_em: null,
        fixada: false,
        ultima_leitura_em: null,
        conversa: completa,
      },
      moderacao: true,
    };
  }

  const participante = await db.ConversaParticipante.findOne({
    where: { conversa_id: conversaId, usuario_id: contexto.usuarioId },
    include: [CONVERSA()],
  });

  return { participante, moderacao: false };
}

module.exports = { listar, detalhe, totalNaoLidas };
