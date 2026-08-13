'use strict';

const db = require('../../models');
const config = require('../../config');
const filas = require('../../filas');
const senhaProvider = require('../../providers/senha');
const tokenService = require('../auth/auth.token.service');
const auditoria = require('../auditoria/auditoria.service');
const { erros } = require('../../utils/erros');
const { normalizarEmail, mascararEmail } = require('../../utils/texto');

/**
 * Troca de e-mail com reconfirmação.
 *
 * O endereço novo **não entra na conta ao ser pedido** — ele viaja no
 * `destino` do token de verificação e só substitui o antigo quando o código
 * enviado para ele é conferido. Gravar antes seria entregar a conta a quem
 * digitou errado (perde a recuperação) ou a quem sequestrou uma sessão
 * (ganha a recuperação).
 *
 * O código é o mesmo mecanismo do auth (`auth.token.service`, tipo
 * `verificacao_email`): reimplementar OTP aqui garantiria que só um dos dois
 * fosse corrigido no dia de uma falha.
 */

/** aviso ao endereço ANTIGO — é assim que o dono descobre um sequestro */
function avisarEnderecoAnterior(usuario, novoEmail) {
  return filas.enfileirar(
    'email.enviar',
    {
      para: usuario.email,
      assunto: 'Pedido de troca de e-mail — AgroPeças MT',
      texto:
        `Olá, ${usuario.nome.split(' ')[0]}!\n\n` +
        `Alguém pediu para trocar o e-mail desta conta para ${mascararEmail(novoEmail)}.\n` +
        'A troca só vale depois de confirmada no endereço novo. Se não foi você, ' +
        'troque sua senha agora e fale com a gente.',
    },
    { prioridade: 1 }
  );
}

async function solicitarTroca(contexto, { email, senhaAtual }) {
  const usuario = contexto.usuario;
  const novoNormalizado = normalizarEmail(email);

  /* senha atual porque e-mail é a chave de recuperação: sem esta conferência,
     uma sessão roubada vira posse definitiva da conta */
  const confere = await senhaProvider.conferir(senhaAtual, usuario.senha_hash);
  if (!confere) throw erros.validacao({ senhaAtual: 'A senha atual está incorreta.' });

  if (novoNormalizado === usuario.email_normalizado) {
    throw erros.validacao({ email: 'Este já é o seu e-mail.' });
  }

  const emUso = await db.Usuario.findOne({ where: { email_normalizado: novoNormalizado } });
  if (emUso) {
    /* mesmo 409 do cadastro: o endereço precisa ser único e negar em silêncio
       deixaria o usuário esperando um código que nunca chegaria */
    throw erros.conflito('Este e-mail já está em uso.', { campos: { email: 'Já está em uso.' } });
  }

  const { codigo } = await tokenService.emitir({
    usuarioId: usuario.id,
    tipo: 'verificacao_email',
    destino: email.trim(),
    minutos: config.auth.otpMinutos,
    contexto,
  });

  await filas.enfileirar('email.enviar', {
    para: email.trim(),
    modelo: 'verificacao_email',
    dados: {
      nome: usuario.nome.split(' ')[0],
      codigo,
      link: `${config.app.webUrl}/conta/email?codigo=${codigo}`,
    },
  });

  await avisarEnderecoAnterior(usuario, email.trim()).catch(() => null);

  return {
    solicitado: true,
    destino: mascararEmail(email),
    expiraEmMinutos: config.auth.otpMinutos,
  };
}

async function confirmarTroca(contexto, { codigo }) {
  const usuario = contexto.usuario;

  /* `conferir` (e não `validar`) para poder ler o `destino` antes de consumir:
     é o token que carrega qual endereço está sendo confirmado */
  const registro = await tokenService.conferir({
    usuarioId: usuario.id,
    tipo: 'verificacao_email',
    codigo,
  });

  const novoEmail = (registro.destino || '').trim();
  const novoNormalizado = normalizarEmail(novoEmail);

  if (!novoEmail || novoNormalizado === usuario.email_normalizado) {
    throw erros.invalido('Não há troca de e-mail pendente.', { code: 'SEM_TROCA_PENDENTE' });
  }

  /* alguém pode ter cadastrado o endereço entre o pedido e a confirmação */
  const emUso = await db.Usuario.findOne({ where: { email_normalizado: novoNormalizado } });
  if (emUso) throw erros.conflito('Este e-mail já está em uso.');

  const anterior = usuario.email;

  await db.sequelize.transaction(async (transacao) => {
    /* consumir o token e trocar o e-mail são duas tabelas: ou as duas escritas
       valem, ou nenhuma — um token gasto sem troca aplicada deixaria o usuário
       sem e-mail novo e sem código */
    await registro.update({ usado_em: new Date() }, { transaction: transacao });
    await usuario.update(
      {
        email: novoEmail,
        email_normalizado: novoNormalizado,
        /* o endereço novo acabou de provar que existe e é do titular */
        email_verificado_em: new Date(),
        status: usuario.status === 'pendente' ? 'ativo' : usuario.status,
      },
      { transaction: transacao }
    );
  });

  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: 'usuarios',
    entidadeId: usuario.id,
    antes: { email: anterior },
    depois: { email: novoEmail },
    motivo: 'troca de e-mail confirmada',
  });

  return usuario;
}

module.exports = { solicitarTroca, confirmarTroca };
