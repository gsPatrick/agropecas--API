'use strict';

const { layout, botao, CORES, FONTE } = require('./layout');

/** primeiro e-mail depois do cadastro confirmado — `auth.verificacao.service.js` */
function boasVindas({ nome }) {
  const config = require('../../../config');
  const link = config.app.webUrl;

  const corpoHtml = `
    <h1 style="margin:0 0 16px; font-family:${FONTE}; font-size:22px; font-weight:800; color:${CORES.ink};">
      Bem-vindo à AgroPeças MT
    </h1>
    <p style="margin:0; font-family:${FONTE}; font-size:15px; line-height:1.6; color:${CORES.ink2};">
      Olá, ${nome}! Sua conta já está pronta. A partir de agora você pode publicar
      anúncios, buscar peças e serviços, e falar direto com quem tem o que você precisa —
      tudo em Mato Grosso.
    </p>
    ${botao('Publicar meu primeiro anúncio', `${link}/painel/anuncios/novo`)}
    <p style="margin:20px 0 0; font-family:${FONTE}; font-size:13px; line-height:1.6; color:${CORES.ink3};">
      Qualquer dúvida sobre como funciona, é só responder este e-mail.
    </p>
  `;

  return {
    assunto: 'Bem-vindo à AgroPeças MT',
    html: layout({
      preheader: 'Sua conta está pronta — publique seu primeiro anúncio.',
      tituloTopo: 'Conta confirmada',
      corpoHtml,
    }),
    texto: `Olá, ${nome}!\n\nSua conta está pronta. Publique seu primeiro anúncio em ${link}.`,
  };
}

module.exports = boasVindas;
