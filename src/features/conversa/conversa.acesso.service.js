'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const { escopoDe, exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');

/**
 * Porteiro da feature. **Toda** operação passa por aqui — inclusive a
 * paginação de mensagens, que é onde a checagem costuma ser esquecida porque
 * "a conversa já foi aberta antes".
 *
 * Duas decisões que valem explicação:
 *
 * 1. **404 para conversa alheia, nunca 403.** Responder 403 confirmaria que o
 *    id existe, e um laço sobre uuids devolveria o mapa das conversas do
 *    sistema. Quem não participa recebe exatamente a mesma resposta de quem
 *    inventou um id.
 *
 * 2. **Moderação lê, mas deixa rastro.** Quem tem `conversa.ler.todas`
 *    (moderador e Admin) abre a conversa sem ser participante — e cada
 *    abertura grava em `logs_acesso_dado`, com os DOIS titulares. Poder de ler
 *    conversa privada sem registro é o que a LGPD cobra na auditoria.
 */

const naoExiste = () => erros.naoEncontrado('Conversa');

/** a outra ponta, a partir do registro da conversa */
const outraParteId = (conversa, usuarioId) =>
  String(conversa.anunciante_id) === String(usuarioId)
    ? conversa.interessado_id
    : conversa.anunciante_id;

/**
 * Carrega a conversa exigindo participação.
 *
 * @param acao       chave RBAC da operação (`conversa.responder`, …)
 * @param opcoes.somenteAberta  operação de escrita não vale em conversa
 *                              encerrada ou bloqueada
 */
async function exigirParticipacao(contexto, conversaId, acao, opcoes = {}) {
  const { transacao, somenteAberta = false, permitirModeracao = false } = opcoes;

  const conversa = await db.Conversa.findByPk(conversaId, {
    include: [{ model: db.ConversaParticipante, as: 'participantes' }],
    /* sem `lock`: o Postgres recusa FOR UPDATE do lado externo de um JOIN, e
       aqui não há o que travar — os contadores são atualizados com
       `increment`, que já é atômico no banco */
    transaction: transacao,
  });

  if (!conversa) throw naoExiste();

  const participante = (conversa.participantes || []).find(
    (item) => String(item.usuario_id) === String(contexto.usuarioId)
  );

  if (!participante) {
    /* `pode()` não serve aqui: quem tem apenas o escopo `propria` passaria por
       ele quando o alvo não informa dono. A pergunta certa é se o escopo é
       TOTAL */
    const moderacao = permitirModeracao && escopoDe(contexto, 'conversa.ler') === 'todos';
    if (!moderacao) throw naoExiste();

    await registrarAcessoDeModeracao(contexto, conversa);
    return { conversa, participante: null, moderacao: true, outroId: null };
  }

  /* participação não dispensa capacidade: uma conta suspensa de responder
     continua participante e mesmo assim não envia */
  exigir(contexto, acao, { donoId: contexto.usuarioId });

  if (somenteAberta && conversa.status !== 'aberta') {
    throw erros.invalido('Esta conversa não está aberta.', { status: conversa.status });
  }

  return {
    conversa,
    participante,
    moderacao: false,
    outroId: outraParteId(conversa, contexto.usuarioId),
  };
}

/** leitura de dado pessoal de terceiro pela moderação — LGPD, art. 37 */
function registrarAcessoDeModeracao(contexto, conversa) {
  return db.LogAcessoDado.bulkCreate(
    [conversa.anunciante_id, conversa.interessado_id].map((titularId) => ({
      ator_id: contexto.usuarioId,
      titular_id: titularId,
      recurso: 'conversa',
      recurso_id: conversa.id,
      motivo: 'leitura de conversa pela moderação',
      ip_hash: contexto.ipHash || null,
      user_agent: contexto.userAgent || null,
    }))
  ).catch((erro) => {
    /* mesma regra da auditoria: log perdido é ruim, mas derrubar a apuração de
       uma denúncia porque o log falhou é pior */
    console.error('[conversa] falha ao registrar acesso de moderação:', erro.message);
  });
}

/**
 * Há bloqueio entre as duas pessoas?
 *
 * **Vale nos dois sentidos**, de propósito. Bloquear no AgroPeças significa
 * "não quero contato com esta pessoa", e contato é mão dupla: se só o sentido
 * bloqueador→bloqueado valesse, quem foi bloqueado continuaria abrindo conversa
 * e escrevendo, e a vítima veria exatamente o que quis evitar. Se só o sentido
 * inverso valesse, bastaria bloquear alguém para ficar imune ao próprio
 * bloqueio. A consequência aceita é que bloquear encerra a via para os dois —
 * e é isso que a tela informa antes de confirmar.
 *
 * Uma consulta só, com índice único (usuario_id, bloqueado_id) atendendo os
 * dois lados do OR.
 */
async function existeBloqueioEntre(umId, outroId) {
  if (!umId || !outroId || String(umId) === String(outroId)) return null;

  return db.BloqueioUsuario.findOne({
    where: {
      [Op.or]: [
        { usuario_id: umId, bloqueado_id: outroId },
        { usuario_id: outroId, bloqueado_id: umId },
      ],
    },
    attributes: ['id', 'usuario_id', 'bloqueado_id'],
  });
}

/** versão que lança — usada antes de iniciar conversa e antes de cada envio */
async function exigirSemBloqueio(umId, outroId) {
  const bloqueio = await existeBloqueioEntre(umId, outroId);
  if (!bloqueio) return null;

  /* mensagem igual nos dois sentidos: dizer "você foi bloqueado" entregaria a
     quem foi bloqueado a informação de que a outra pessoa o bloqueou */
  throw erros.semPermissao('Não é possível conversar com este usuário.', {
    motivo: 'BLOQUEIO',
  });
}

module.exports = {
  exigirParticipacao,
  existeBloqueioEntre,
  exigirSemBloqueio,
  outraParteId,
  naoExiste,
};
