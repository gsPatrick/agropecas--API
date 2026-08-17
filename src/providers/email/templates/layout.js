'use strict';

const config = require('../../../config');

/**
 * Moldura HTML compartilhada por todo e-mail transacional.
 *
 * Tabela, não flexbox/grid: é o único layout que sobrevive ao motor de
 * renderização do Outlook desktop (Word, não um navegador). Todo estilo vai
 * inline — a mesma razão. As cores e a fonte batem com os tokens do site
 * (`app/globals.css` no front); como não há garantia de que Sora/Inter
 * carreguem no cliente de e-mail, a pilha cai para fontes de sistema com a
 * mesma personalidade (geométrica, sem serifa).
 *
 * `logoUrl` aponta para `/assets/email/logo.png` — PNG rasterizado do mesmo
 * SVG do `BrandMark` do front (`components/BrandMark/BrandMark.js`), porque
 * SVG inline não é confiável em cliente de e-mail nenhum, e nem todos
 * carregam imagem remota redimensionada com qualidade.
 */

const CORES = {
  forest: '#1f5e2d',
  forestDeep: '#16431f',
  lime: '#a3c23c',
  bone: '#f4f6f2',
  ink: '#1a1a1a',
  ink2: '#4a524c',
  ink3: '#7c857e',
  white: '#ffffff',
  linha: '#e2e6df',
};

const FONTE = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONTE_TITULO = "'Sora', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function logoUrl() {
  return `${config.app.url}/assets/email/logo.png`;
}

/**
 * @param {string} preheader — texto curto que aparece na prévia da caixa de
 *   entrada, antes de abrir o e-mail. Some do corpo visível (altura 0),
 *   mas os leitores de tela e o preview do Gmail/Outlook o leem.
 * @param {string} tituloTopo — a linha grande dentro do cartão verde do topo
 * @param {string} corpoHtml — o miolo do e-mail, já em HTML (parágrafos,
 *   botão, etc.) — ver os templates individuais
 */
function layout({ preheader = '', tituloTopo, corpoHtml }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>AgroPeças MT</title>
</head>
<body style="margin:0; padding:0; background-color:${CORES.bone}; font-family:${FONTE};">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">
    ${preheader}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${CORES.bone}; padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%; background-color:${CORES.white}; border-radius:16px; overflow:hidden; border:1px solid ${CORES.linha};">

          <!-- topo -->
          <tr>
            <td style="background-color:${CORES.forestDeep}; padding:32px 40px; text-align:center;">
              <img src="${logoUrl()}" width="56" height="56" alt="AgroPeças MT" style="display:block; margin:0 auto 12px; border:0;" />
              <div style="font-family:${FONTE_TITULO}; font-weight:800; font-size:20px; letter-spacing:-0.01em; color:${CORES.white};">
                AGROPEÇAS <span style="color:${CORES.lime};">MT</span>
              </div>
              ${
                tituloTopo
                  ? `<div style="font-family:${FONTE}; font-size:13px; font-weight:600; letter-spacing:0.04em; text-transform:uppercase; color:${CORES.lime}; margin-top:10px;">${tituloTopo}</div>`
                  : ''
              }
            </td>
          </tr>

          <!-- corpo -->
          <tr>
            <td style="padding:40px;">
              ${corpoHtml}
            </td>
          </tr>

          <!-- rodapé -->
          <tr>
            <td style="padding:24px 40px 32px; border-top:1px solid ${CORES.linha};">
              <p style="margin:0 0 8px; font-family:${FONTE}; font-size:12px; line-height:1.6; color:${CORES.ink3};">
                AgroPeças MT — conectando produtores, lojas e prestadores de serviço em Mato Grosso.
              </p>
              <p style="margin:0; font-family:${FONTE}; font-size:12px; line-height:1.6; color:${CORES.ink3};">
                Dúvidas? Fale com a gente em
                <a href="mailto:contato@agropecasmt.com.br" style="color:${CORES.forest}; text-decoration:none;">contato@agropecasmt.com.br</a>
              </p>
            </td>
          </tr>

        </table>

        <p style="margin:20px 0 0; font-family:${FONTE}; font-size:11px; color:${CORES.ink3};">
          © ${new Date().getFullYear()} AgroPeças MT. Este é um e-mail automático — não é preciso responder.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** botão de ação — mesmo verde/branco/raio do `Button` do front */
function botao(texto, href) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
      <tr>
        <td style="border-radius:10px; background-color:${CORES.forest};">
          <a href="${href}" target="_blank" style="display:inline-block; padding:14px 28px; font-family:${FONTE}; font-size:15px; font-weight:700; color:${CORES.white}; text-decoration:none; border-radius:10px;">
            ${texto}
          </a>
        </td>
      </tr>
    </table>`;
}

/** o código de verificação, em destaque — usado por verificação de e-mail e recuperação de senha */
function blocoCodigo(codigo) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td align="center" style="background-color:${CORES.bone}; border:1px dashed ${CORES.linha}; border-radius:12px; padding:20px;">
          <span style="font-family:${FONTE_TITULO}; font-size:32px; font-weight:800; letter-spacing:0.28em; color:${CORES.forestDeep};">
            ${codigo}
          </span>
        </td>
      </tr>
    </table>`;
}

module.exports = { layout, botao, blocoCodigo, CORES, FONTE, FONTE_TITULO };
