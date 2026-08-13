'use strict';

const { validarDocumento } = require('../utils/documento');
const { paraE164, somenteDigitos } = require('../utils/texto');

/**
 * Regras que dependem do domínio brasileiro e do AgroPeças — não da
 * biblioteca de validação.
 *
 * Cada uma recebe `(valor, valorDaRegra, corpo)` e devolve mensagem de erro ou
 * `null`. O adaptador só as pluga; ele não sabe o que é CPF.
 *
 * Vazio e nulo passam sempre: presença é assunto de `obrigatorio`. Misturar as
 * duas coisas faria um campo opcional preenchido em branco virar erro de
 * formato.
 */

const vazio = (valor) => valor === undefined || valor === null || valor === '';

const REGRAS = {
  documento: (valor) =>
    vazio(valor) || validarDocumento(valor) ? null : 'CPF ou CNPJ inválido.',

  telefone: (valor) =>
    vazio(valor) || paraE164(valor) ? null : 'Telefone inválido. Informe com DDD.',

  cep: (valor) =>
    vazio(valor) || somenteDigitos(valor).length === 8 ? null : 'CEP inválido.',

  aceito: (valor) => (valor === true ? null : 'É preciso aceitar para continuar.'),

  igualA: (valor, outroCampo, corpo) =>
    valor === corpo?.[outroCampo] ? null : 'Os valores não conferem.',

  personalizada: (valor, fn, corpo) => (typeof fn === 'function' ? fn(valor, corpo) : null),
};

module.exports = { REGRAS, vazio };
