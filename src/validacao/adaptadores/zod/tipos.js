'use strict';

const { z } = require('zod');

/**
 * Tradução: tipo da nossa especificação → construtor do zod.
 *
 * Este é um dos poucos arquivos do projeto onde `zod` aparece. Nenhuma feature
 * chega até aqui — elas falam `campos.email()`, e quem sabe o que isso vira é
 * o adaptador.
 *
 * `coerce` nos numéricos e booleanos é proposital: query string entrega tudo
 * como texto, e `?pagina=2` precisa virar número sem cada rota lembrar disso.
 */

/**
 * Mensagem do campo, distinguindo AUSENTE de MAL PREENCHIDO.
 *
 * Sem isso, quem esquece o nome recebe "Precisa ser um texto." — verdade
 * técnica que não ajuda ninguém a preencher o formulário. Quem declarou
 * `.obrigatorio('Informe seu nome.')` espera ver exatamente isso.
 */
const erroDe = (spec, mensagemDeTipo) => (problema) =>
  problema.input === undefined || problema.input === null
    ? spec.mensagemObrigatorio || mensagemDeTipo
    : spec.mensagem || mensagemDeTipo;

const CONSTRUTORES = {
  texto: (spec) => z.string({ error: erroDe(spec, 'Precisa ser um texto.') }),

  email: (spec) => z.email({ error: erroDe(spec, 'E-mail inválido.') }),

  uuid: (spec) => z.uuid({ error: erroDe(spec, 'Identificador inválido.') }),

  numero: (spec) => z.coerce.number({ error: erroDe(spec, 'Precisa ser um número.') }),

  inteiro: (spec) =>
    z.coerce.number({ error: erroDe(spec, 'Precisa ser um número inteiro.') }).int(),

  booleano: (spec) => booleanoTolerante(spec),

  data: (spec) => z.coerce.date({ error: erroDe(spec, 'Data inválida.') }),

  enum: (spec) =>
    z.enum(spec.opcoes, {
      error: erroDe(spec, `Valor inválido. Use: ${spec.opcoes.join(', ')}.`),
    }),

  lista: (spec, compilar) => z.array(compilar(spec.itens.spec ?? spec.itens)),

  objeto: (spec, compilar) => {
    const forma = {};
    Object.entries(spec.campos).forEach(([nome, campo]) => {
      forma[nome] = compilar(campo.spec ?? campo);
    });
    return z.object(forma);
  },

  qualquer: () => z.any(),
};

/**
 * `"true"`, `"1"` e `"sim"` viram `true`.
 * Checkbox de formulário e query string chegam como texto; exigir booleano
 * puro faria o front converter em cada tela — e esquecer em alguma.
 */
function booleanoTolerante(spec = {}) {
  return z.preprocess((valor) => {
    if (typeof valor === 'string') {
      const normal = valor.trim().toLowerCase();
      if (['true', '1', 'sim', 'on'].includes(normal)) return true;
      if (['false', '0', 'nao', 'não', 'off'].includes(normal)) return false;
    }
    return valor;
  }, z.boolean({ error: erroDe(spec, 'Precisa ser verdadeiro ou falso.') }));
}

const construir = (spec, compilar) => {
  const construtor = CONSTRUTORES[spec.tipo] || CONSTRUTORES.qualquer;
  return construtor(spec, compilar);
};

module.exports = { construir, CONSTRUTORES };
