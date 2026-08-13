'use strict';

const db = require('../../models');
const config = require('../../config');
const filas = require('../../filas');
const tokenService = require('./auth.token.service');
const { erros } = require('../../utils/erros');

/**
 * Confirmação de e-mail. Separado do registro porque o mesmo fluxo é usado em
 * três momentos: logo após o cadastro, no reenvio pedido pelo usuário e na
 * troca de e-mail (quando esse módulo existir).
 */

async function enviarCodigo(usuario, contexto) {
  if (usuario.email_verificado_em) {
    throw erros.conflito('Este e-mail já foi confirmado.');
  }

  const { codigo } = await tokenService.emitir({
    usuarioId: usuario.id,
    tipo: 'verificacao_email',
    destino: usuario.email,
    minutos: config.auth.verificacaoEmailHoras * 60,
    contexto,
  });

  /* vai para a fila: o cadastro não pode ficar refém do tempo de resposta de
     um provedor de e-mail, e a retentativa com espera é da fila, não daqui */
  await filas.enfileirar('email.enviar', {
    para: usuario.email,
    modelo: 'verificacao_email',
    dados: {
      nome: usuario.nome.split(' ')[0],
      codigo,
      link: `${config.app.webUrl}/entrar/confirmar?email=${encodeURIComponent(usuario.email)}&codigo=${codigo}`,
    },
  });

  return { enviado: true, expiraEmMinutos: config.auth.verificacaoEmailHoras * 60 };
}

async function confirmar({ usuario, codigo }) {
  if (usuario.email_verificado_em) return usuario;

  await tokenService.validar({
    usuarioId: usuario.id,
    tipo: 'verificacao_email',
    codigo,
  });

  /* conta nasce 'pendente'; confirmar é o que a torna 'ativa' */
  await usuario.update({
    email_verificado_em: new Date(),
    status: usuario.status === 'pendente' ? 'ativo' : usuario.status,
  });

  await filas.enfileirar('email.enviar', {
    para: usuario.email,
    modelo: 'boas_vindas',
    dados: { nome: usuario.nome.split(' ')[0] },
  });

  return usuario;
}

/** busca por e-mail para os endpoints públicos de reenvio/confirmação */
const porEmail = (emailNormalizado) =>
  db.Usuario.findOne({ where: { email_normalizado: emailNormalizado } });

module.exports = { enviarCodigo, confirmar, porEmail };
