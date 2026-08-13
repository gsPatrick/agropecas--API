'use strict';

const { erros } = require('../../utils/erros');
const { TIPO } = require('./configuracao.constants');

/**
 * Tipagem das configurações — o assunto mais chato e o mais importante.
 *
 * A coluna é JSONB, então o banco aceita qualquer coisa em qualquer chave.
 * Sem esta camada, `anuncio.dias_validade` viraria a string "60" no dia em que
 * alguém salvar pelo formulário do admin (HTML manda tudo como texto), e o
 * módulo de anúncio faria `new Date(Date.now() + '60' * dia)` — que não quebra,
 * só dá o resultado errado. Bug caro justamente por não estourar.
 *
 * Regra: **converter na leitura, validar na escrita**. Quem consome nunca
 * escreve `Number(config)`.
 *
 * `null` é sempre válido, em qualquer tipo: no vocabulário deste sistema
 * `null` significa "sem limite / não definido" (ver `anuncio.max_ativos_por_usuario`
 * e os limites de plano, que usam a mesma convenção).
 */

/** conversão tolerante, usada na LEITURA — nunca lança */
function converter(valor, tipo) {
  if (valor === null || valor === undefined) return null;

  switch (tipo) {
    case TIPO.NUMERO: {
      const numero = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
      return Number.isFinite(numero) ? numero : null;
    }

    case TIPO.BOOLEANO: {
      if (typeof valor === 'boolean') return valor;
      return ['1', 'true', 'sim', 'yes'].includes(String(valor).trim().toLowerCase());
    }

    case TIPO.TEXTO:
      return typeof valor === 'string' ? valor : String(valor);

    case TIPO.LISTA:
      if (Array.isArray(valor)) return valor;
      /* linha de compatibilidade: valor gravado antes desta camada existir
         pode estar como "a,b,c" — aceitar evita ter que rodar migração de dados */
      return typeof valor === 'string' ? valor.split(',').map((item) => item.trim()).filter(Boolean) : [];

    case TIPO.JSON:
      if (typeof valor !== 'string') return valor;
      try {
        return JSON.parse(valor);
      } catch (erro) {
        return null;
      }

    default:
      return valor;
  }
}

/** descrição amigável do que a chave espera — vai na mensagem de erro 422 */
const ESPERADO = {
  [TIPO.TEXTO]: 'um texto',
  [TIPO.NUMERO]: 'um número',
  [TIPO.BOOLEANO]: 'verdadeiro ou falso',
  [TIPO.JSON]: 'um objeto JSON',
  [TIPO.LISTA]: 'uma lista',
};

/**
 * Validação ESTRITA, usada na ESCRITA — lança 422.
 *
 * Estrita de propósito: aceitar "60" e converter para 60 na gravação pareceria
 * gentileza, mas esconderia do front que ele está mandando o tipo errado, e o
 * dia em que a conversão não for óbvia (uma lista? um JSON?) o dado entra
 * torto. Melhor a tela aprender agora.
 *
 * A única flexibilidade é numérica: `"60"` vindo de um `<input>` é o caso real
 * mais comum, então texto que é número inteiro/decimal puro é aceito e
 * normalizado. Texto arbitrário em campo numérico continua sendo 422.
 */
function validar(valor, tipo, chave) {
  if (valor === null || valor === undefined) return null;

  const recusar = () =>
    erros.validacao({
      valor: `A configuração "${chave}" espera ${ESPERADO[tipo] || 'um valor válido'}.`,
    });

  switch (tipo) {
    case TIPO.NUMERO: {
      if (typeof valor === 'number') {
        if (!Number.isFinite(valor)) throw recusar();
        return valor;
      }
      if (typeof valor === 'string' && /^-?\d+([.,]\d+)?$/.test(valor.trim())) {
        return Number(valor.trim().replace(',', '.'));
      }
      throw recusar();
    }

    case TIPO.BOOLEANO:
      if (typeof valor !== 'boolean') throw recusar();
      return valor;

    case TIPO.TEXTO:
      if (typeof valor !== 'string') throw recusar();
      return valor;

    case TIPO.LISTA:
      if (!Array.isArray(valor)) throw recusar();
      return valor;

    case TIPO.JSON:
      if (typeof valor !== 'object' || Array.isArray(valor)) throw recusar();
      return valor;

    default:
      throw recusar();
  }
}

module.exports = { converter, validar, ESPERADO };
