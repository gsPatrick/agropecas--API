'use strict';

const db = require('../../models');
const tempoReal = require('../../tempo-real');
const auditoria = require('../auditoria/auditoria.service');
const acesso = require('./conversa.acesso.service');
const { ACAO } = require('./conversa.constants');

/**
 * Ciclo de vida da conversa: arquivar e encerrar.
 *
 * São coisas diferentes e por isso moram em tabelas diferentes:
 *
 * - **arquivar é pessoal** (`conversa_participantes.arquivada_em`). Some da
 *   minha caixa de entrada e não muda nada para o outro — ele nem fica sabendo.
 *   Mensagem nova não desarquiva sozinha: quem arquivou decidiu não ver aquilo,
 *   e reabrir a thread na cara dele desfaria a decisão.
 *
 * - **encerrar é da conversa** (`conversas.status`). Vale para os dois, e
 *   ninguém escreve mais. É o "negócio resolvido" ou o "não tenho mais
 *   interesse", e por isso vira auditoria: encerrar tira o canal de contato de
 *   outra pessoa.
 */

async function arquivar(contexto, conversaId, arquivada = true) {
  const { participante } = await acesso.exigirParticipacao(
    contexto,
    conversaId,
    'conversa.arquivar'
  );

  await db.ConversaParticipante.update(
    { arquivada_em: arquivada ? new Date() : null },
    { where: { id: participante.id } }
  );

  return { arquivada };
}

async function encerrar(contexto, conversaId, { motivo } = {}) {
  const { conversa, outroId } = await acesso.exigirParticipacao(
    contexto,
    conversaId,
    'conversa.encerrar'
  );

  if (conversa.status === 'encerrada') return { status: 'encerrada' };

  const antes = { status: conversa.status };

  await db.Conversa.update(
    {
      status: 'encerrada',
      encerrada_em: new Date(),
      encerrada_por: contexto.usuarioId,
      bloqueada_motivo: motivo || null,
    },
    { where: { id: conversa.id } }
  );

  await auditoria.registrar(contexto, {
    acao: ACAO.CONVERSA_ENCERRADA,
    entidade: 'conversas',
    entidadeId: conversa.id,
    antes,
    depois: { status: 'encerrada' },
    motivo: motivo || null,
  });

  /* o outro precisa ver a caixa de texto sumir sem dar F5 — senão ele digita
     uma resposta inteira para receber 400 no envio */
  const evento = { conversaId: conversa.id, status: 'encerrada', porUsuarioId: contexto.usuarioId };
  tempoReal.paraConversa(conversa.id, tempoReal.EVENTOS.CONVERSA_ATUALIZADA, evento);
  tempoReal.paraUsuario(outroId, tempoReal.EVENTOS.CONVERSA_ATUALIZADA, evento);

  return { status: 'encerrada' };
}

module.exports = { arquivar, encerrar };
