'use strict';

const db = require('../../models');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const acesso = require('./conversa.acesso.service');
const { ANUNCIO_CONTATAVEL } = require('./conversa.constants');

/**
 * Início de conversa — **sempre a partir de um anúncio**.
 *
 * A cliente foi explícita (Maturacao/05, §8): o chat é por anúncio, não por
 * perfil. No perfil só aparece o WhatsApp. É o anúncio que dá contexto à
 * mensagem, permite moderar com referência e evita o contato solto, que é por
 * onde o spam entra num classificado.
 *
 * Duas pessoas + um anúncio = UMA conversa. A segunda tentativa devolve a
 * mesma, e isso é regra de produto antes de ser detalhe técnico: o interessado
 * que volta ao anúncio três dias depois precisa reencontrar o histórico, não
 * abrir a quarta thread com o mesmo vendedor.
 */

/** o par (anúncio, interessado) é único no banco — a busca usa esse índice */
const existente = (anuncioId, interessadoId, transacao) =>
  db.Conversa.findOne({
    where: { anuncio_id: anuncioId, interessado_id: interessadoId },
    transaction: transacao,
  });

async function iniciar({ anuncioId }, contexto) {
  exigir(contexto, 'conversa.criar');

  const anuncio = await db.Anuncio.findByPk(anuncioId, {
    attributes: ['id', 'usuario_id', 'titulo', 'status'],
  });

  if (!anuncio) throw erros.naoEncontrado('Anúncio');

  if (String(anuncio.usuario_id) === String(contexto.usuarioId)) {
    throw erros.invalido('Você não pode iniciar uma conversa com o próprio anúncio.');
  }

  if (!ANUNCIO_CONTATAVEL.includes(anuncio.status)) {
    throw erros.invalido('Este anúncio não está disponível para contato.', {
      status: anuncio.status,
    });
  }

  /* conversa já existente pula todas as checagens seguintes de propósito: se o
     anunciante desligar o chat depois, a thread aberta continua respondível —
     desligar o chat impede contato NOVO, não abandona quem já estava falando */
  const jaExiste = await existente(anuncio.id, contexto.usuarioId);
  if (jaExiste) return { conversa: jaExiste, criada: false };

  await acesso.exigirSemBloqueio(contexto.usuarioId, anuncio.usuario_id);
  await exigirChatAceito(anuncio.usuario_id);

  return criar(anuncio, contexto.usuarioId);
}

/**
 * `perfis.aceita_chat = false` significa "me chame no WhatsApp".
 *
 * É preferência declarada do anunciante, e o front esconde o botão — mas quem
 * garante é a API: esconder botão não impede um POST.
 */
async function exigirChatAceito(anuncianteId) {
  const perfil = await db.Perfil.findOne({
    where: { usuario_id: anuncianteId },
    attributes: ['id', 'aceita_chat'],
  });

  if (perfil && perfil.aceita_chat === false) {
    throw erros.semPermissao('Este anunciante prefere ser contatado pelo WhatsApp.', {
      motivo: 'CHAT_DESATIVADO',
    });
  }
}

/**
 * Cria a conversa e as duas linhas de participante numa transação: conversa
 * sem participante é conversa que ninguém consegue abrir — nem pela API, nem
 * pelo WebSocket, que valida participação na mesma tabela.
 */
async function criar(anuncio, interessadoId) {
  const transacao = await db.sequelize.transaction();

  try {
    const conversa = await db.Conversa.create(
      {
        anuncio_id: anuncio.id,
        anunciante_id: anuncio.usuario_id,
        interessado_id: interessadoId,
        status: 'aberta',
      },
      { transaction: transacao }
    );

    await db.ConversaParticipante.bulkCreate(
      [
        { conversa_id: conversa.id, usuario_id: anuncio.usuario_id, papel: 'anunciante' },
        { conversa_id: conversa.id, usuario_id: interessadoId, papel: 'interessado' },
      ],
      { transaction: transacao }
    );

    await transacao.commit();
    return { conversa, criada: true };
  } catch (erro) {
    await transacao.rollback();

    /* dois cliques no botão "conversar" chegam juntos e o segundo bate no
       índice único (anuncio_id, interessado_id). Isso não é erro para quem
       clicou: é a mesma conversa, e é ela que volta */
    if (erro.name === 'SequelizeUniqueConstraintError') {
      const conversa = await existente(anuncio.id, interessadoId);
      if (conversa) return { conversa, criada: false };
    }

    throw erro;
  }
}

module.exports = { iniciar, existente };
