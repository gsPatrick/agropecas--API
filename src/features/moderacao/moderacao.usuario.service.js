'use strict';

const db = require('../../models');
const tempoReal = require('../../tempo-real');
const sessaoService = require('../auth/auth.sessao.service');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { adicionarDias } = require('../../utils/datas');
const { exigirMotivo, garantirPodeAgirSobre, registrarAcao } = require('./moderacao.comum');
const { ENTIDADE, MOTIVO_REVOGACAO, SUSPENSAO } = require('./moderacao.constants');

/**
 * Sanção de conta: suspender, banir, restaurar.
 *
 * A regra que atravessa o arquivo: **mudar o status não basta**. Um usuário
 * suspenso continua com access token válido por até 15 minutos e com refresh
 * válido por semanas — quem foi suspenso por assédio no chat seguiria
 * mandando mensagem enquanto o token não expirasse. Por isso toda sanção
 * encerra as sessões e avisa os aparelhos conectados.
 *
 * As duas travas de quem pode agir vêm de `moderacao.comum.js`:
 * não se pune a si mesmo, e só Admin age sobre conta de Admin.
 */

/** derruba tudo e avisa cada aparelho — a tela cai sozinha, sem esperar F5 */
async function encerrarAcesso(usuarioId, motivo) {
  const encerradas = await sessaoService.encerrarTodas(usuarioId, { motivo });

  tempoReal.paraUsuario(usuarioId, tempoReal.EVENTOS.SESSAO_ENCERRADA, {
    motivo,
    em: new Date().toISOString(),
  });

  return encerradas;
}

/** carrega o alvo com o que a sanção precisa; nunca traz `senha_hash` */
async function carregar(usuarioId) {
  const usuario = await db.Usuario.findByPk(usuarioId, {
    attributes: ['id', 'nome', 'email', 'status', 'motivo_status', 'suspenso_ate'],
  });
  if (!usuario) throw erros.naoEncontrado('Usuário');
  return usuario;
}

/**
 * Suspensão temporária, com prazo.
 *
 * O prazo é obrigatório na prática (tem padrão de 7 dias) porque suspensão sem
 * data é banimento com outro nome — e banimento tem permissão própria, mais
 * restrita. `auth.login.service` reativa sozinho quando o prazo vence: obrigar
 * o suporte a destravar na mão transformaria prazo em tarefa esquecida.
 */
async function suspender(contexto, usuarioId, { motivo, dias } = {}) {
  exigir(contexto, 'usuario.suspender', { donoId: usuarioId });
  await garantirPodeAgirSobre(contexto, usuarioId);

  const justificativa = exigirMotivo(motivo);
  const usuario = await carregar(usuarioId);

  if (usuario.status === 'banido') {
    throw erros.conflito('Esta conta já está banida — suspender não faria diferença.');
  }

  const prazo = adicionarDias(dias || SUSPENSAO.DIAS_PADRAO);
  const antes = { status: usuario.status, suspenso_ate: usuario.suspenso_ate };

  await usuario.update({
    status: 'suspenso',
    suspenso_ate: prazo,
    motivo_status: justificativa,
  });

  const encerradas = await encerrarAcesso(usuario.id, MOTIVO_REVOGACAO.SUSPENSAO);

  await registrarAcao(contexto, {
    acao: 'suspender',
    entidade: ENTIDADE.USUARIO,
    entidadeId: usuario.id,
    antes,
    depois: { status: 'suspenso', suspenso_ate: prazo, sessoes_encerradas: encerradas },
    motivo: justificativa,
    notificar: {
      usuarioId: usuario.id,
      tipo: 'conta_suspensa',
      titulo: 'Sua conta foi suspensa',
      mensagem: `Sua conta está suspensa até ${prazo.toLocaleDateString('pt-BR')}. Motivo: ${justificativa}`,
      dados: { suspensoAte: prazo, motivo: justificativa },
    },
  });

  return { usuario, sessoesEncerradas: encerradas };
}

/** banimento — definitivo, e por isso com permissão separada da suspensão */
async function banir(contexto, usuarioId, { motivo } = {}) {
  exigir(contexto, 'usuario.banir', { donoId: usuarioId });
  await garantirPodeAgirSobre(contexto, usuarioId);

  const justificativa = exigirMotivo(motivo);
  const usuario = await carregar(usuarioId);

  if (usuario.status === 'banido') throw erros.conflito('Esta conta já está banida.');

  const antes = { status: usuario.status };

  await usuario.update({
    status: 'banido',
    suspenso_ate: null,
    motivo_status: justificativa,
  });

  const encerradas = await encerrarAcesso(usuario.id, MOTIVO_REVOGACAO.BANIMENTO);

  await registrarAcao(contexto, {
    acao: 'banir',
    entidade: ENTIDADE.USUARIO,
    entidadeId: usuario.id,
    antes,
    depois: { status: 'banido', sessoes_encerradas: encerradas },
    motivo: justificativa,
    notificar: {
      usuarioId: usuario.id,
      tipo: 'conta_suspensa',
      titulo: 'Sua conta foi banida',
      mensagem: `Sua conta foi banida da plataforma. Motivo: ${justificativa}`,
      dados: { motivo: justificativa },
    },
  });

  return { usuario, sessoesEncerradas: encerradas };
}

/**
 * Reverte suspensão ou banimento.
 *
 * Também exige motivo: soltar alguém é decisão tão relatável quanto prender —
 * e é a que mais gera pergunta depois ("quem liberou aquela conta?").
 */
async function restaurar(contexto, usuarioId, { motivo } = {}) {
  exigir(contexto, 'usuario.restaurar', { donoId: usuarioId });
  await garantirPodeAgirSobre(contexto, usuarioId);

  const justificativa = exigirMotivo(motivo);
  const usuario = await carregar(usuarioId);

  if (!['suspenso', 'banido'].includes(usuario.status)) {
    throw erros.conflito('Esta conta não está suspensa nem banida.');
  }

  const antes = { status: usuario.status, motivo_status: usuario.motivo_status };

  await usuario.update({ status: 'ativo', suspenso_ate: null, motivo_status: null });

  await registrarAcao(contexto, {
    acao: 'restaurar',
    entidade: ENTIDADE.USUARIO,
    entidadeId: usuario.id,
    antes,
    depois: { status: 'ativo' },
    motivo: justificativa,
    notificar: {
      usuarioId: usuario.id,
      tipo: 'sistema',
      titulo: 'Sua conta foi reativada',
      mensagem: 'Sua conta voltou a ficar ativa. Você já pode entrar normalmente.',
      dados: {},
    },
  });

  return { usuario };
}

module.exports = { suspender, banir, restaurar, encerrarAcesso };
