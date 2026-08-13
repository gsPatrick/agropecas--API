'use strict';

const db = require('../../models');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const tempoReal = require('../../tempo-real');
const sessaoService = require('../auth/auth.sessao.service');
const auditoria = require('../auditoria/auditoria.service');
const { MOTIVO_REVOGACAO } = require('./usuario.constants');

/**
 * Suspender, banir e restaurar conta.
 *
 * Duas regras atravessam as três operações:
 *
 * 1. **Motivo é obrigatório.** Mudança de status sem motivo registrado é
 *    exatamente o que ninguém consegue explicar seis meses depois, quando o
 *    usuário reclama — e é o que a LGPD chama de prestação de contas.
 *
 * 2. **Tirar acesso é derrubar sessão.** Marcar `status = 'suspenso'` sem
 *    encerrar as sessões deixaria o access token (15 min, não revogável)
 *    valendo — e o refresh continuaria rodando. A suspensão só é real quando
 *    a sessão morre.
 *
 * Ninguém pode aplicar isso a si mesmo: um Admin que se bane deixa a
 * plataforma sem dono, e um moderador que se suspende cria um chamado de
 * suporte que ele mesmo não consegue mais atender.
 */

/** carrega o alvo e barra o tiro no próprio pé */
async function carregarAlvo(contexto, id, acao) {
  exigir(contexto, acao);

  if (String(id) === String(contexto.usuarioId)) {
    throw erros.invalido('Você não pode aplicar esta ação à sua própria conta.', {
      code: 'ACAO_SOBRE_SI_MESMO',
    });
  }

  const usuario = await db.Usuario.findByPk(id);
  if (!usuario) throw erros.naoEncontrado('Usuário');

  return usuario;
}

/** encerra tudo e avisa os aparelhos abertos — o evento é entrega, não registro */
async function derrubarSessoes(usuario, motivo) {
  const encerradas = await sessaoService.encerrarTodas(usuario.id, { motivo });

  tempoReal.paraUsuario(usuario.id, tempoReal.EVENTOS.SESSAO_ENCERRADA, { motivo });

  return encerradas;
}

async function suspender(contexto, id, { motivo, ate }) {
  const usuario = await carregarAlvo(contexto, id, 'usuario.suspender');

  const prazo = new Date(ate);
  if (Number.isNaN(prazo.getTime()) || prazo <= new Date()) {
    throw erros.validacao({ ate: 'A suspensão precisa terminar no futuro.' });
  }

  const antes = { status: usuario.status, suspenso_ate: usuario.suspenso_ate };

  await usuario.update({ status: 'suspenso', motivo_status: motivo, suspenso_ate: prazo });
  const encerradas = await derrubarSessoes(usuario, MOTIVO_REVOGACAO.SUSPENSAO);

  await auditoria.registrar(contexto, {
    acao: 'suspender',
    entidade: 'usuarios',
    entidadeId: usuario.id,
    antes,
    depois: { status: 'suspenso', suspenso_ate: prazo },
    motivo,
  });

  return { usuario, sessoesEncerradas: encerradas };
}

async function banir(contexto, id, { motivo }) {
  const usuario = await carregarAlvo(contexto, id, 'usuario.banir');

  const antes = { status: usuario.status };

  /* `suspenso_ate` é limpo: banimento não tem data de fim, e deixar o prazo
     antigo faria um job de "reativar suspensos" ressuscitar um banido */
  await usuario.update({ status: 'banido', motivo_status: motivo, suspenso_ate: null });
  const encerradas = await derrubarSessoes(usuario, MOTIVO_REVOGACAO.BANIMENTO);

  await auditoria.registrar(contexto, {
    acao: 'banir',
    entidade: 'usuarios',
    entidadeId: usuario.id,
    antes,
    depois: { status: 'banido' },
    motivo,
  });

  return { usuario, sessoesEncerradas: encerradas };
}

async function restaurar(contexto, id, { motivo } = {}) {
  const usuario = await carregarAlvo(contexto, id, 'usuario.restaurar');

  if (usuario.anonimizado_em) {
    /* conta anonimizada não volta: os dados pessoais já não existem, e
       "restaurar" devolveria uma conta sem dono identificável */
    throw erros.conflito('Conta anonimizada não pode ser restaurada.');
  }

  const antes = { status: usuario.status, motivo_status: usuario.motivo_status };

  await usuario.update({
    /* sem e-mail confirmado ela volta para `pendente`, não para `ativo`:
       restaurar não é atalho para pular a verificação */
    status: usuario.email_verificado_em ? 'ativo' : 'pendente',
    motivo_status: motivo || null,
    suspenso_ate: null,
    tentativas_login: 0,
    bloqueado_ate: null,
  });

  await auditoria.registrar(contexto, {
    acao: 'restaurar',
    entidade: 'usuarios',
    entidadeId: usuario.id,
    antes,
    depois: { status: usuario.status },
    motivo,
  });

  return usuario;
}

module.exports = { suspender, banir, restaurar };
