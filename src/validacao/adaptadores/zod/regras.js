'use strict';

const { REGRAS } = require('../../regras-dominio');

/**
 * Aplica as regras da especificação sobre um esquema zod já construído.
 *
 * Duas famílias, tratadas de formas diferentes:
 *
 *   - **estruturais** (min, max, tamanho, regex): o zod já sabe fazer, então
 *     usa o método nativo — a mensagem sai melhor e a checagem é mais rápida;
 *   - **de domínio** (CPF, telefone, CEP, aceite): viram `refine`, chamando
 *     `regras-dominio.js`. O zod nunca aprende o que é CPF.
 */

const ESTRUTURAIS = {
  min: (esquema, valor, mensagem) =>
    esquema.min?.(valor, { error: mensagem || mensagemMin(esquema, valor) }) ?? esquema,

  max: (esquema, valor, mensagem) =>
    esquema.max?.(valor, { error: mensagem || mensagemMax(esquema, valor) }) ?? esquema,

  tamanho: (esquema, valor, mensagem) =>
    esquema.length?.(valor, { error: mensagem || `Precisa ter exatamente ${valor} caracteres.` }) ??
    esquema,

  regex: (esquema, valor, mensagem) =>
    esquema.regex?.(valor, { error: mensagem || 'Formato inválido.' }) ?? esquema,
};

const ehTexto = (esquema) => typeof esquema.regex === 'function';

const mensagemMin = (esquema, valor) =>
  ehTexto(esquema) ? `Precisa ter ao menos ${valor} caracteres.` : `Precisa ser no mínimo ${valor}.`;

const mensagemMax = (esquema, valor) =>
  ehTexto(esquema) ? `Precisa ter no máximo ${valor} caracteres.` : `Precisa ser no máximo ${valor}.`;

/**
 * @param corpoRef  referência viva ao objeto sendo validado — regras como
 *                  `igualA` precisam enxergar os outros campos
 */
function aplicar(esquema, regras = [], corpoRef) {
  return regras.reduce((atual, regra) => {
    const estrutural = ESTRUTURAIS[regra.nome];
    if (estrutural) return estrutural(atual, regra.valor, regra.mensagem);

    const dominio = REGRAS[regra.nome];
    if (!dominio) return atual;

    /* `check` em vez de `refine` para poder emitir a mensagem que a própria
       regra de domínio devolveu, em vez de uma genérica */
    return atual.check((ctx) => {
      const problema = dominio(ctx.value, regra.valor, corpoRef.atual);
      if (problema) {
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          message: regra.mensagem || problema,
        });
      }
    });
  }, esquema);
}

module.exports = { aplicar, ESTRUTURAIS };
