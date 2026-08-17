'use strict';

const { layout, botao, blocoCodigo, CORES, FONTE } = require('./layout');

/** confirmação de e-mail no cadastro — `auth.registro.service.js` */
function verificacaoEmail({ nome, codigo, link }) {
  const corpoHtml = `
    <h1 style="margin:0 0 16px; font-family:${FONTE}; font-size:22px; font-weight:800; color:${CORES.ink};">
      Confirme seu e-mail
    </h1>
    <p style="margin:0; font-family:${FONTE}; font-size:15px; line-height:1.6; color:${CORES.ink2};">
      Olá, ${nome}! Falta só um passo para sua conta estar pronta na AgroPeças MT.
      Use o código abaixo para confirmar seu e-mail:
    </p>
    ${blocoCodigo(codigo)}
    <p style="margin:0 0 4px; font-family:${FONTE}; font-size:14px; line-height:1.6; color:${CORES.ink2};">
      Prefere um clique? Use o botão abaixo:
    </p>
    ${botao('Confirmar e-mail', link)}
    <p style="margin:20px 0 0; font-family:${FONTE}; font-size:13px; line-height:1.6; color:${CORES.ink3};">
      O código vale por 30 minutos. Se você não criou uma conta na AgroPeças MT, pode ignorar este e-mail.
    </p>
  `;

  return {
    assunto: 'Confirme seu e-mail — AgroPeças MT',
    html: layout({
      preheader: `Seu código de confirmação é ${codigo}.`,
      tituloTopo: 'Confirmação de cadastro',
      corpoHtml,
    }),
    texto: `Olá, ${nome}!\n\nSeu código de confirmação é ${codigo}.\nOu acesse: ${link}\n\nO código vale por 30 minutos.`,
  };
}

module.exports = verificacaoEmail;
