'use strict';

const { normalizarEmail, somenteDigitos, paraE164 } = require('../utils/texto');

/**
 * Transformações nomeadas, aplicadas ao valor ANTES das regras.
 *
 * Ficam aqui, e não dentro do adaptador, porque são **regra nossa**: telefone
 * vira E.164, CEP vira dígitos, e-mail vira minúsculo. Trocar a biblioteca de
 * validação não pode mudar como o dado chega no banco.
 */
const TRANSFORMACOES = {
  aparar: (valor) => (typeof valor === 'string' ? valor.trim() : valor),

  minusculas: (valor) => (typeof valor === 'string' ? normalizarEmail(valor) : valor),

  somenteDigitos: (valor) => (typeof valor === 'string' ? somenteDigitos(valor) : valor),

  /* devolve o original quando não converte: quem reprova é a regra `telefone`,
     com mensagem de campo — transformação não é lugar de recusar dado */
  e164: (valor) => (typeof valor === 'string' ? paraE164(valor) || valor : valor),
};

/** aplica a cadeia declarada na especificação, na ordem */
const aplicar = (valor, nomes = []) =>
  nomes.reduce((atual, nome) => {
    const transformacao = TRANSFORMACOES[nome];
    return transformacao ? transformacao(atual) : atual;
  }, valor);

module.exports = { TRANSFORMACOES, aplicar };
