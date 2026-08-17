'use strict';

const { layout, CORES, FONTE } = require('./layout');

/** aviso de segurança — dispara sempre que a senha muda, mesmo pedida pelo próprio usuário */
function senhaAlterada({ nome }) {
  const corpoHtml = `
    <h1 style="margin:0 0 16px; font-family:${FONTE}; font-size:22px; font-weight:800; color:${CORES.ink};">
      Sua senha foi alterada
    </h1>
    <p style="margin:0; font-family:${FONTE}; font-size:15px; line-height:1.6; color:${CORES.ink2};">
      Olá, ${nome}! A senha da sua conta na AgroPeças MT acabou de ser alterada com sucesso.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background-color:#fdf3e7; border:1px solid #f0dcb8; border-radius:12px; padding:16px 20px;">
          <p style="margin:0; font-family:${FONTE}; font-size:14px; line-height:1.6; color:#8a5a1f;">
            <strong>Não foi você?</strong> Fale com a gente agora em
            <a href="mailto:contato@agropecasmt.com.br" style="color:#8a5a1f;">contato@agropecasmt.com.br</a>
            — sua conta pode estar comprometida.
          </p>
        </td>
      </tr>
    </table>
    <p style="margin:0; font-family:${FONTE}; font-size:13px; line-height:1.6; color:${CORES.ink3};">
      Se foi você mesmo, não precisa fazer nada — este e-mail é só um aviso de segurança.
    </p>
  `;

  return {
    assunto: 'Sua senha foi alterada — AgroPeças MT',
    html: layout({
      preheader: 'A senha da sua conta acabou de ser alterada.',
      tituloTopo: 'Aviso de segurança',
      corpoHtml,
    }),
    texto: `Olá, ${nome}!\n\nA senha da sua conta acabou de ser alterada. Se não foi você, fale com a gente imediatamente.`,
  };
}

module.exports = senhaAlterada;
