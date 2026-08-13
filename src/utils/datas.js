'use strict';

/** Aritmética de data sem dependência externa. */

const agora = () => new Date();

const adicionarMinutos = (minutos, base = new Date()) =>
  new Date(base.getTime() + minutos * 60 * 1000);

const adicionarHoras = (horas, base = new Date()) => adicionarMinutos(horas * 60, base);

const adicionarDias = (dias, base = new Date()) => adicionarMinutos(dias * 24 * 60, base);

const expirou = (data) => !data || new Date(data).getTime() <= Date.now();

const segundosAte = (data) =>
  Math.max(0, Math.ceil((new Date(data).getTime() - Date.now()) / 1000));

/** "15m", "30d", "12h" → milissegundos. Mesmo formato aceito pelo JWT. */
function duracaoParaMs(texto) {
  const encontrado = String(texto).match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!encontrado) return Number(texto) || 0;

  const valor = Number(encontrado[1]);
  const unidade = encontrado[2].toLowerCase();
  const fatores = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return valor * fatores[unidade];
}

module.exports = { agora, adicionarMinutos, adicionarHoras, adicionarDias, expirou, segundosAte, duracaoParaMs };
