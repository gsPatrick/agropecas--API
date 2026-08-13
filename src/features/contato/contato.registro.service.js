'use strict';

const db = require('../../models');
const filas = require('../../filas');
const { erros } = require('../../utils/erros');
const limite = require('./contato.limite.service');
const { CANAL, NOTIFICACAO_TIPO } = require('./contato.constants');

/* garante que `contato.agregarMetricas` exista no registro de trabalhos antes
   do primeiro `enfileirar`. `src/filas/index.js` só carrega os trabalhos que
   existiam quando foi escrito, e ele é arquivo compartilhado — a linha do
   require precisa entrar lá para o worker também conhecer o job; está
   reportado. Aqui o require resolve o processo web, e `require` é cacheado,
   então não há risco de registro duplicado. */
require('../../filas/trabalhos/contato.trabalho');

/**
 * Registro da INTENÇÃO de contato.
 *
 * Este é o coração do módulo do ponto de vista do produto. A plataforma não
 * intermedeia a venda — o combinado sai no WhatsApp e a API nunca vê o resto
 * (Maturacao/05, §7). O que ela consegue registrar é o momento em que alguém
 * decidiu falar com o anunciante, e é exatamente esse número que responde à
 * única pergunta que a cliente faz sobre o próprio anúncio: *"quantas pessoas
 * me chamaram?"*.
 *
 * Por isso o registro acontece mesmo quando o contato é anônimo e mesmo quando
 * o canal é o WhatsApp, que leva a conversa para fora. Perder essa linha é
 * perder a métrica inteira.
 */

/** dados mínimos do anúncio para registrar — sem TEXT, sem join */
async function carregarAnuncio(anuncioId) {
  const anuncio = await db.Anuncio.findByPk(anuncioId, {
    attributes: ['id', 'usuario_id', 'perfil_id', 'titulo', 'codigo', 'status'],
  });
  if (!anuncio) throw erros.naoEncontrado('Anúncio');
  return anuncio;
}

/** coluna de contador correspondente ao canal, quando existe */
function colunaDoCanal(canal) {
  if (canal === CANAL.WHATSAPP || canal === CANAL.TELEFONE) return 'total_contatos_whatsapp';
  if (canal === CANAL.CHAT) return 'total_contatos_chat';
  return null;
}

/**
 * Grava o contato.
 *
 * Duas regras que valem explicação:
 *
 * **O anunciante não gera contato para si mesmo.** Abrir o próprio anúncio e
 * clicar no botão para conferir se funciona é o teste que todo anunciante faz
 * no primeiro dia — e inflaria o número que ele mesmo vai olhar depois.
 *
 * **A janela decide o contador, não a existência da linha.** O registro só é
 * criado quando é contato novo naquela janela; repetição dentro dela devolve
 * `duplicado: true` e não escreve nada. Guardar todas as repetições daria uma
 * tabela cheia de F5 e um `anuncio_contatos` que o anunciante lê como "a mesma
 * pessoa me chamou nove vezes", o que não aconteceu.
 */
async function registrar(contexto, { anuncioId, canal, origem, conversaId }) {
  const anuncio = await carregarAnuncio(anuncioId);

  if (contexto.usuarioId && String(contexto.usuarioId) === String(anuncio.usuario_id)) {
    return { registrado: false, motivo: 'proprio_anuncio', contato: null };
  }

  const novo = await limite.ehContatoNovo(contexto, { anuncioId, canal });
  if (!novo) return { registrado: false, motivo: 'duplicado', contato: null };

  const contato = await db.sequelize.transaction(async (transacao) => {
    const criado = await db.AnuncioContato.create(
      {
        anuncio_id: anuncio.id,
        anunciante_id: anuncio.usuario_id,
        interessado_id: contexto.usuarioId || null,
        canal,
        conversa_id: conversaId || null,
        origem: origem || null,
        /* LGPD: só o hash. O IP em claro não passa do middleware de contexto */
        ip_hash: contexto.ipHash || null,
        user_agent: contexto.userAgent || null,
      },
      { transaction: transacao }
    );

    const coluna = colunaDoCanal(canal);
    if (coluna) {
      /* increment atômico: dois interessados clicando ao mesmo tempo, em
         instâncias diferentes, perderiam uma contagem no leia-some-grave */
      await db.Anuncio.increment(coluna, {
        by: 1,
        where: { id: anuncio.id },
        transaction: transacao,
      });
    }

    return criado;
  });

  /* a agregação diária e o `perfis.total_contatos` saem por job: recalcular a
     cada clique colocaria dois UPDATE a mais no caminho da resposta de uma
     rota que é chamada em toda listagem */
  await filas.enfileirar('contato.agregarMetricas', { anuncioId: anuncio.id }).catch(() => null);

  await notificarAnunciante(anuncio, canal);

  return { registrado: true, motivo: null, contato };
}

/**
 * Avisa o anunciante.
 *
 * Contrato fixo, combinado com o módulo `notificacao` — o payload não é livre.
 * O aviso vai só pelo canal `sistema`: e-mail a cada clique de WhatsApp
 * transformaria a caixa de entrada de uma loja ativa em spam, e quem quiser
 * resumo por e-mail terá o digest do módulo de notificação.
 *
 * Falha aqui não derruba o registro: o contato já está no banco, que é o fato;
 * a notificação é entrega complementar (padrão §9).
 */
async function notificarAnunciante(anuncio, canal) {
  const rotulo = canal === CANAL.CHAT ? 'pelo chat' : `pelo ${canal}`;

  await filas
    .enfileirar('notificacao.criar', {
      usuarioId: anuncio.usuario_id,
      tipo: NOTIFICACAO_TIPO,
      titulo: 'Alguém quer falar com você',
      mensagem: `Um interessado pediu seu contato ${rotulo} no anúncio "${anuncio.titulo}".`,
      dados: { anuncioId: anuncio.id },
      entidade: 'anuncios',
      entidadeId: anuncio.id,
      canais: ['sistema'],
    })
    .catch((erro) => console.error('[contato] falha ao enfileirar notificação:', erro.message));
}

module.exports = { registrar, carregarAnuncio, notificarAnunciante };
