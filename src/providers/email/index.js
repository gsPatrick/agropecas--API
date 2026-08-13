'use strict';

const config = require('../../config');

/**
 * Provider de e-mail.
 *
 * Hoje só registra no console: o objetivo é que a feature de auth já chame a
 * interface certa. Trocar por SMTP/Resend/SES é reescrever apenas `enviar`,
 * sem tocar em service nenhum.
 *
 * Toda mensagem é montada a partir de `templates_notificacao` quando existir;
 * o texto embutido aqui é só o fallback do desenvolvimento.
 */

const MODELOS = {
  verificacao_email: ({ nome, codigo, link }) => ({
    assunto: 'Confirme seu e-mail — AgroPeças MT',
    texto: `Olá, ${nome}!\n\nSeu código de confirmação é ${codigo}.\nOu acesse: ${link}\n\nO código vale por 30 minutos.`,
  }),
  recuperacao_senha: ({ nome, codigo, link }) => ({
    assunto: 'Recuperação de senha — AgroPeças MT',
    texto: `Olá, ${nome}!\n\nSeu código para criar uma nova senha é ${codigo}.\nOu acesse: ${link}\n\nO código vale por 15 minutos. Se não foi você, ignore este e-mail.`,
  }),
  senha_alterada: ({ nome }) => ({
    assunto: 'Sua senha foi alterada — AgroPeças MT',
    texto: `Olá, ${nome}!\n\nA senha da sua conta acabou de ser alterada. Se não foi você, fale com a gente imediatamente.`,
  }),
  boas_vindas: ({ nome }) => ({
    assunto: 'Bem-vindo à AgroPeças MT',
    texto: `Olá, ${nome}!\n\nSua conta está pronta. Publique seu primeiro anúncio em ${config.app.webUrl}.`,
  }),
};

async function enviar({ para, modelo, dados = {}, assunto, texto }) {
  const montado = modelo && MODELOS[modelo] ? MODELOS[modelo](dados) : { assunto, texto };

  if (config.app.env !== 'production') {
    console.log('\n─── [email] ──────────────────────────────');
    console.log(`para   : ${para}`);
    console.log(`assunto: ${montado.assunto}`);
    console.log(montado.texto);
    console.log('──────────────────────────────────────────\n');
    return { entregue: true, simulado: true };
  }

  // TODO: integrar provedor real. Falha de e-mail NÃO deve derrubar o cadastro.
  console.warn('[email] provider real não configurado — mensagem descartada');
  return { entregue: false, simulado: false };
}

module.exports = { enviar, MODELOS };
