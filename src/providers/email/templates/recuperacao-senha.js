'use strict';

const { layout, botao, blocoCodigo, CORES, FONTE } = require('./layout');

/** recuperação de senha — `auth.senha.service.js` */
function recuperacaoSenha({ nome, codigo, link }) {
  const corpoHtml = `
    <h1 style="margin:0 0 16px; font-family:${FONTE}; font-size:22px; font-weight:800; color:${CORES.ink};">
      Vamos criar uma senha nova
    </h1>
    <p style="margin:0; font-family:${FONTE}; font-size:15px; line-height:1.6; color:${CORES.ink2};">
      Olá, ${nome}! Recebemos um pedido para redefinir a senha da sua conta.
      Use o código abaixo para continuar:
    </p>
    ${blocoCodigo(codigo)}
    <p style="margin:0 0 4px; font-family:${FONTE}; font-size:14px; line-height:1.6; color:${CORES.ink2};">
      Ou clique direto no botão:
    </p>
    ${botao('Criar nova senha', link)}
    <p style="margin:20px 0 0; font-family:${FONTE}; font-size:13px; line-height:1.6; color:${CORES.ink3};">
      O código vale por 15 minutos. Se não foi você quem pediu, ignore este e-mail —
      sua senha continua a mesma e nada muda na sua conta.
    </p>
  `;

  return {
    assunto: 'Recuperação de senha — AgroPeças MT',
    html: layout({
      preheader: `Seu código para criar uma nova senha é ${codigo}.`,
      tituloTopo: 'Recuperação de senha',
      corpoHtml,
    }),
    texto: `Olá, ${nome}!\n\nSeu código para criar uma nova senha é ${codigo}.\nOu acesse: ${link}\n\nO código vale por 15 minutos. Se não foi você, ignore este e-mail.`,
  };
}

module.exports = recuperacaoSenha;
