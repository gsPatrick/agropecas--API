'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const filas = require('../../filas');
const tempoReal = require('../../tempo-real');
const acesso = require('./conversa.acesso.service');
const mapper = require('./conversa.mapper');
const { CONTEUDO_MAXIMO, PREVIA_MAXIMA } = require('./conversa.constants');
const { erros } = require('../../utils/erros');

/**
 * Envio e leitura de mensagem — o caminho quente da feature.
 *
 * Ordem obrigatória: **grava, depois emite, depois notifica.** O evento de
 * tempo real é entrega complementar, nunca o registro do fato — se o WebSocket
 * estiver fora, a mensagem já está no banco e aparece quando a tela abrir.
 * Inverter isso produziria a pior falha possível num chat: o balão aparece na
 * tela do outro e some no F5.
 */

/**
 * Higiene do conteúdo.
 *
 * O que **não** fazemos aqui: escapar HTML. A API guarda e devolve texto puro,
 * em JSON, e é o front que escapa ao renderizar — escapar na gravação
 * transformaria "peça < 5mm" em "peça &lt; 5mm" no banco, o dano ficaria
 * permanente e ainda assim um segundo consumidor (app, exportação) receberia
 * texto já mexido. Ver Conversa.md §6 para o contrato com o front.
 *
 * O que fazemos: tirar caracteres de controle (invisíveis, usados para
 * disfarçar conteúdo e para quebrar log), limitar linhas em branco em sequência
 * e cortar no teto.
 */
function limparConteudo(bruto) {
  const texto = String(bruto || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

  if (!texto) throw erros.validacao({ conteudo: 'Escreva alguma coisa.' });
  if (texto.length > CONTEUDO_MAXIMO) {
    throw erros.validacao({
      conteudo: `A mensagem passa de ${CONTEUDO_MAXIMO} caracteres.`,
    });
  }

  return texto;
}

/** a prévia mora numa STRING(160): cortar é obrigação, não estética */
const previa = (texto) =>
  texto.replace(/\s+/g, ' ').slice(0, PREVIA_MAXIMA);

async function enviar(contexto, conversaId, { conteudo }) {
  const { conversa, participante, outroId } = await acesso.exigirParticipacao(
    contexto,
    conversaId,
    'conversa.responder',
    { somenteAberta: true }
  );

  /* bloqueio é conferido a CADA envio, não só ao abrir a conversa: quem
     bloqueia no meio do papo espera que a próxima mensagem não chegue */
  await acesso.exigirSemBloqueio(contexto.usuarioId, outroId);

  const texto = limparConteudo(conteudo);
  const agora = new Date();

  const mensagem = await db.sequelize.transaction(async (transacao) => {
    const criada = await db.Mensagem.create(
      {
        conversa_id: conversa.id,
        remetente_id: contexto.usuarioId,
        tipo: 'texto',
        conteudo: texto,
        entregue_em: agora,
      },
      { transaction: transacao }
    );

    /* prévia e contador na mesma instrução do UPDATE: é o que faz a caixa de
       entrada não precisar tocar em `mensagens` depois */
    await db.Conversa.update(
      {
        ultima_mensagem_em: agora,
        ultima_mensagem_previa: previa(texto),
        ultima_mensagem_de: contexto.usuarioId,
        total_mensagens: db.Sequelize.literal('total_mensagens + 1'),
      },
      { where: { id: conversa.id }, transaction: transacao }
    );

    /* `increment` vira `nao_lidas = nao_lidas + 1` no banco: dois envios
       simultâneos somam dois. Ler, somar em JavaScript e gravar perderia um */
    await db.ConversaParticipante.increment('nao_lidas', {
      by: 1,
      where: { conversa_id: conversa.id, usuario_id: outroId },
      transaction: transacao,
    });

    /* quem escreve está com a tela aberta: zerar o próprio contador evita o
       badge fantasma de quem respondeu sem rolar até o fim */
    if (participante.nao_lidas > 0 || !participante.ultima_leitura_em) {
      await db.ConversaParticipante.update(
        { nao_lidas: 0, ultima_leitura_em: agora },
        { where: { id: participante.id }, transaction: transacao }
      );
    }

    return criada;
  });

  await entregar({ contexto, conversa, mensagem, outroId });

  return mensagem;
}

/**
 * Entrega em tempo real + notificação.
 *
 * Nenhuma consulta ao banco: tudo que vai no evento já está em memória desde a
 * gravação. Emissão que relê o registro transforma cada mensagem em duas
 * viagens ao banco, no ponto mais movimentado do sistema.
 *
 * São DUAS salas, de propósito:
 *   - a da conversa, para quem está com a tela aberta (inclusive as outras
 *     abas do próprio remetente, que precisam mostrar o balão);
 *   - a do destinatário, para o badge da caixa de entrada quando ele está em
 *     outra tela do app.
 * Ambas resolvidas por `tempoReal.salas` no SERVIDOR — nenhum id de sala vem
 * do cliente.
 */
async function entregar({ contexto, conversa, mensagem, outroId }) {
  const evento = {
    conversaId: conversa.id,
    anuncioId: conversa.anuncio_id,
    mensagem: mapper.mensagem(mensagem),
  };

  tempoReal.paraConversa(conversa.id, tempoReal.EVENTOS.MENSAGEM_NOVA, evento);
  tempoReal.paraUsuario(outroId, tempoReal.EVENTOS.MENSAGEM_NOVA, evento);

  /* notificar quem está com a conversa na tela é ruído: o balão já apareceu.
     `conectados` conta sockets do usuário — se ele não tem nenhum, está fora
     do app e é aí que a notificação vale */
  const online = await tempoReal.conectados(outroId);
  if (online > 0) return;

  await filas.enfileirar('notificacao.criar', {
    usuarioId: outroId,
    tipo: 'mensagem_nova',
    titulo: 'Nova mensagem',
    mensagem: `${contexto.usuario?.nome || 'Alguém'} respondeu sobre um anúncio.`,
    dados: { conversaId: conversa.id },
    entidade: 'conversas',
    entidadeId: conversa.id,
    canais: ['sistema'],
  });
}

/**
 * Marca a conversa como lida.
 *
 * Zera a COLUNA `nao_lidas` — nunca recontando mensagens — e carimba
 * `lida_em` nas mensagens do outro que ainda não tinham recibo, em um único
 * UPDATE em lote.
 */
async function marcarLida(contexto, conversaId) {
  const { conversa, participante, outroId } = await acesso.exigirParticipacao(
    contexto,
    conversaId,
    'conversa.ler'
  );

  const agora = new Date();

  await db.ConversaParticipante.update(
    { nao_lidas: 0, ultima_leitura_em: agora },
    { where: { id: participante.id } }
  );

  const [marcadas] = await db.Mensagem.update(
    { lida_em: agora },
    {
      where: {
        conversa_id: conversa.id,
        remetente_id: { [Op.ne]: contexto.usuarioId },
        lida_em: null,
      },
    }
  );

  const evento = { conversaId: conversa.id, porUsuarioId: contexto.usuarioId, em: agora };

  tempoReal.paraConversa(conversa.id, tempoReal.EVENTOS.MENSAGEM_LIDA, evento);
  /* o recibo interessa a quem enviou, mesmo que ele já tenha saído da tela */
  tempoReal.paraUsuario(outroId, tempoReal.EVENTOS.MENSAGEM_LIDA, evento);

  return { naoLidas: 0, marcadas, em: agora };
}

module.exports = { enviar, marcarLida, limparConteudo, previa };
