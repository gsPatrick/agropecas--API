'use strict';

const db = require('../../models');
const tempoReal = require('../../tempo-real');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const auditoria = require('../auditoria/auditoria.service');
const acesso = require('./conversa.acesso.service');
const { ACAO, CONTEUDO_REMOVIDO } = require('./conversa.constants');

/**
 * Remoção de mensagem — soft delete.
 *
 * `removida_em` em vez de DELETE porque quem apaga uma mensagem não pode
 * apagar a prova de que ela existiu: sem o registro, a denúncia de abuso chega
 * à moderação sem base, e a palavra de um vale a do outro.
 *
 * **Decisão que diverge do comentário do model** (`mensagem.js` fala em
 * substituir o conteúdo): o conteúdo permanece na coluna e é o MAPPER que o
 * troca por "Mensagem removida." na resposta. Apagar o texto no banco na hora
 * da remoção destruiria justamente a evidência que a moderação precisa ler
 * depois — e a proteção contra vazamento tem que existir no mapper de qualquer
 * jeito, para mensagem removida por terceiro. O expurgo definitivo é assunto do
 * job de retenção da LGPD, não do clique do usuário.
 */
async function removerMensagem(contexto, mensagemId, { motivo } = {}) {
  const mensagem = await db.Mensagem.findByPk(mensagemId, {
    attributes: ['id', 'conversa_id', 'remetente_id', 'conteudo', 'removida_em', 'criado_em'],
  });

  /* mesma resposta de mensagem inexistente e de mensagem alheia: a checagem de
     participação vem logo abaixo e devolve 404 pelo mesmo motivo */
  if (!mensagem) throw erros.naoEncontrado('Mensagem');

  const { conversa } = await acesso.exigirParticipacao(
    contexto,
    mensagem.conversa_id,
    'conversa.ler',
    { permitirModeracao: true }
  );

  /* o escopo `propria` só remove a própria mensagem; `todas` (moderador,
     Admin) remove qualquer uma — e o registro de auditoria é o que diferencia
     as duas na apuração */
  exigir(contexto, 'mensagem.remover', { donoId: mensagem.remetente_id });

  if (mensagem.removida_em) return { removida: true, em: mensagem.removida_em };

  const agora = new Date();

  await db.Mensagem.update(
    { removida_em: agora, removida_por: contexto.usuarioId, removida_motivo: motivo || null },
    { where: { id: mensagem.id } }
  );

  /* se era a última, a caixa de entrada continuaria exibindo o texto removido
     na prévia — o dado sairia da conversa e ficaria na lista */
  if (
    conversa.ultima_mensagem_em &&
    new Date(conversa.ultima_mensagem_em).getTime() === new Date(mensagem.criado_em).getTime()
  ) {
    await db.Conversa.update(
      { ultima_mensagem_previa: CONTEUDO_REMOVIDO },
      { where: { id: conversa.id } }
    );
  }

  await auditoria.registrar(contexto, {
    acao: ACAO.MENSAGEM_REMOVIDA,
    entidade: 'mensagens',
    entidadeId: mensagem.id,
    antes: { removida: false },
    depois: { removida: true },
    motivo: motivo || null,
    /* remoção feita por quem não escreveu é intervenção de moderação */
    emNomeDe:
      String(mensagem.remetente_id) === String(contexto.usuarioId) ? null : mensagem.remetente_id,
  });

  /* não existe evento de "mensagem removida" no catálogo; CONVERSA_ATUALIZADA
     manda a tela recarregar o trecho, que é o efeito desejado */
  tempoReal.paraConversa(conversa.id, tempoReal.EVENTOS.CONVERSA_ATUALIZADA, {
    conversaId: conversa.id,
    mensagemRemovidaId: mensagem.id,
  });

  return { removida: true, em: agora };
}

module.exports = { removerMensagem };
