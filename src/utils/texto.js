'use strict';

/**
 * Normalização de texto e máscaras.
 *
 * `normalizar` é usado em toda coluna `*_normalizado`: a busca do usuário
 * brasileiro nunca vem acentuada, e comparar "Tangará" com "tangara" sem isso
 * simplesmente não acha.
 */

const normalizar = (valor = '') =>
  String(valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const slugify = (valor = '') =>
  normalizar(valor)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);

const somenteDigitos = (valor = '') => String(valor).replace(/\D/g, '');

const normalizarEmail = (valor = '') => String(valor).trim().toLowerCase();

/**
 * Telefone brasileiro em E.164 (+5565999999999).
 * O WhatsApp é o canal principal do produto; guardar em formato livre
 * inviabiliza montar link `wa.me` depois.
 */
function paraE164(valor, ddiPadrao = '55') {
  const digitos = somenteDigitos(valor);
  if (!digitos) return null;

  if (String(valor).trim().startsWith('+')) return `+${digitos}`;
  if (digitos.length === 10 || digitos.length === 11) return `+${ddiPadrao}${digitos}`;
  if (digitos.length === 12 || digitos.length === 13) return `+${digitos}`;
  return null;
}

const mascararEmail = (email = '') => {
  const [usuario, dominio] = String(email).split('@');
  if (!dominio) return '***';
  const visivel = usuario.slice(0, 2);
  return `${visivel}${'*'.repeat(Math.max(1, usuario.length - 2))}@${dominio}`;
};

const mascararTelefone = (telefone = '') => {
  const digitos = somenteDigitos(telefone);
  if (digitos.length < 4) return '***';
  return `${'*'.repeat(digitos.length - 4)}${digitos.slice(-4)}`;
};

const capitalizarNome = (valor = '') =>
  String(valor)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((parte) =>
      ['de', 'da', 'do', 'das', 'dos', 'e'].includes(parte)
        ? parte
        : parte.charAt(0).toUpperCase() + parte.slice(1)
    )
    .join(' ');

module.exports = {
  normalizar,
  slugify,
  somenteDigitos,
  normalizarEmail,
  paraE164,
  mascararEmail,
  mascararTelefone,
  capitalizarNome,
};
