'use strict';

const { Resend } = require('resend');
const config = require('../../config');
const templates = require('./templates');

/**
 * Provider de e-mail — Resend.
 *
 * Em desenvolvimento continua só registrando no console: e-mail de teste
 * automático (cadastro de conta demo no boot, testes manuais) não pode
 * disparar para caixa de entrada de verdade nem gastar cota da conta Resend.
 * Em produção, sem `RESEND_API_KEY` configurada, cai no mesmo aviso de
 * antes — falha de e-mail nunca pode derrubar cadastro/login, só avisa.
 *
 * `EMAIL_FROM` sem configurar usa o domínio de testes do Resend
 * (`onboarding@resend.dev`), que funciona sem verificação de domínio — mas
 * ele só entrega para o próprio e-mail cadastrado na conta Resend. Assim que
 * `agropecasmt.com.br` estiver verificado lá, troca `EMAIL_FROM` para um
 * endereço desse domínio.
 */

let cliente = null;
function resend() {
  if (!config.email.resendApiKey) return null;
  if (!cliente) cliente = new Resend(config.email.resendApiKey);
  return cliente;
}

async function enviar({ para, modelo, dados = {}, assunto, texto }) {
  const montado = modelo && templates[modelo] ? templates[modelo](dados) : { assunto, texto };

  if (config.app.env !== 'production') {
    console.log('\n─── [email] ──────────────────────────────');
    console.log(`para   : ${para}`);
    console.log(`assunto: ${montado.assunto}`);
    console.log(montado.texto || '(sem versão em texto)');
    console.log('──────────────────────────────────────────\n');
    return { entregue: true, simulado: true };
  }

  const provedor = resend();
  if (!provedor) {
    console.warn('[email] RESEND_API_KEY não configurada — mensagem descartada');
    return { entregue: false, simulado: false };
  }

  try {
    const { data, error } = await provedor.emails.send({
      from: config.email.remetente,
      to: para,
      subject: montado.assunto,
      html: montado.html,
      text: montado.texto,
    });

    if (error) {
      console.error('[email] Resend recusou o envio:', error.message || error);
      return { entregue: false, simulado: false };
    }

    return { entregue: true, simulado: false, id: data?.id };
  } catch (erro) {
    console.error('[email] falha ao enviar:', erro.message);
    return { entregue: false, simulado: false };
  }
}

module.exports = { enviar, templates };
