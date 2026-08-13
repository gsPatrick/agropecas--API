'use strict';

const db = require('../../models');
const { exigir } = require('../../rbac');
const {
  exigirMotivo,
  garantirNaoEhVoceMesmo,
  registrarAcao,
  carregarAnuncio,
  registrarHistoricoDoAnuncio,
  emitirModeracao,
} = require('./moderacao.comum');
const { ENTIDADE } = require('./moderacao.constants');

/**
 * O veredito da fila: aprovar ou reprovar um anúncio.
 *
 * A retirada pontual de conteúdo (ocultar, bloquear foto) é outro assunto e
 * mora em `moderacao.conteudo.service.js` — misturar as duas coisas faria este
 * arquivo crescer sem que ninguém percebesse que são decisões diferentes.
 *
 * As duas ações daqui fazem sempre as mesmas cinco coisas, nesta ordem:
 *   1. conferem permissão COM escopo (o dono é conhecido, então `exigir` recebe
 *      `donoId` — é o que separa moderar de editar o próprio anúncio);
 *   2. recusam moderação sobre si mesmo;
 *   3. gravam estado + linha em `anuncio_historico`, na MESMA transação;
 *   4. auditam em `logs_auditoria` e notificam o dono;
 *   5. avisam a tela do dono por WebSocket.
 *
 * `anuncio_historico` e `logs_auditoria` não são redundantes: o primeiro é a
 * trilha do ANÚNCIO, que o dono e o suporte leem; o segundo é a trilha do
 * ATOR, que a LGPD cobra. Perguntas diferentes, tabelas diferentes.
 */

async function aprovar(contexto, anuncioId, { observacao } = {}) {
  const anuncio = await carregarAnuncio(anuncioId);

  exigir(contexto, 'anuncio.aprovar', { donoId: anuncio.usuario_id });
  garantirNaoEhVoceMesmo(contexto, anuncio.usuario_id);

  const antes = { status: anuncio.status, moderacao_status: anuncio.moderacao_status };

  /* aprovar publica o que estava esperando — mas não ressuscita rascunho:
     o dono ainda não pediu para publicar, e decidir por ele seria intervenção
     onde a moderação não foi chamada */
  const statusNovo = anuncio.status === 'oculto' ? 'publicado' : anuncio.status;

  await db.sequelize.transaction(async (transacao) => {
    await anuncio.update(
      {
        moderacao_status: 'aprovado',
        moderado_por: contexto.usuarioId,
        moderado_em: new Date(),
        moderacao_motivo: observacao || null,
        status: statusNovo,
        publicado_em: statusNovo === 'publicado' && !anuncio.publicado_em ? new Date() : anuncio.publicado_em,
      },
      { transaction: transacao }
    );

    await registrarHistoricoDoAnuncio(
      anuncio,
      contexto,
      { statusAnterior: antes.status, statusNovo, motivo: observacao, alteracoes: { moderacao_status: 'aprovado' } },
      transacao
    );
  });

  await registrarAcao(contexto, {
    acao: 'aprovar',
    entidade: ENTIDADE.ANUNCIO,
    entidadeId: anuncio.id,
    antes,
    depois: { status: statusNovo, moderacao_status: 'aprovado' },
    motivo: observacao,
    notificar: {
      usuarioId: anuncio.usuario_id,
      tipo: 'anuncio_aprovado',
      titulo: 'Seu anúncio foi aprovado',
      mensagem: `O anúncio "${anuncio.titulo}" foi aprovado e está no ar.`,
      dados: { anuncioId: anuncio.id, codigo: anuncio.codigo },
    },
  });

  emitirModeracao(anuncio, 'aprovado');
  return anuncio;
}

async function reprovar(contexto, anuncioId, { motivo } = {}) {
  const anuncio = await carregarAnuncio(anuncioId);

  exigir(contexto, 'anuncio.reprovar', { donoId: anuncio.usuario_id });
  garantirNaoEhVoceMesmo(contexto, anuncio.usuario_id);
  const justificativa = exigirMotivo(motivo);

  const antes = { status: anuncio.status, moderacao_status: anuncio.moderacao_status };

  await db.sequelize.transaction(async (transacao) => {
    await anuncio.update(
      {
        moderacao_status: 'reprovado',
        moderado_por: contexto.usuarioId,
        moderado_em: new Date(),
        moderacao_motivo: justificativa,
        /* reprovado sai do ar, mas não é apagado: o dono precisa poder
           corrigir e voltar à fila */
        status: 'oculto',
      },
      { transaction: transacao }
    );

    await registrarHistoricoDoAnuncio(
      anuncio,
      contexto,
      { statusAnterior: antes.status, statusNovo: 'oculto', motivo: justificativa, alteracoes: { moderacao_status: 'reprovado' } },
      transacao
    );
  });

  await registrarAcao(contexto, {
    acao: 'reprovar',
    entidade: ENTIDADE.ANUNCIO,
    entidadeId: anuncio.id,
    antes,
    depois: { status: 'oculto', moderacao_status: 'reprovado' },
    motivo: justificativa,
    notificar: {
      usuarioId: anuncio.usuario_id,
      tipo: 'anuncio_reprovado',
      titulo: 'Seu anúncio foi reprovado',
      mensagem: `O anúncio "${anuncio.titulo}" foi reprovado. Motivo: ${justificativa}`,
      dados: { anuncioId: anuncio.id, codigo: anuncio.codigo, motivo: justificativa },
    },
  });

  emitirModeracao(anuncio, 'reprovado');
  return anuncio;
}

module.exports = { aprovar, reprovar };
