'use strict';

/**
 * Contrato do adaptador de validação.
 *
 * O sistema NÃO conhece zod. Conhece este contrato. Trocar a biblioteca é
 * escrever um arquivo novo em `adaptadores/` e apontar `definirAdaptador` —
 * nenhuma feature muda uma linha.
 *
 * A regra que sustenta isso: `require('zod')` só pode aparecer dentro de
 * `adaptadores/`. Em qualquer outro lugar do projeto é violação de camada, e
 * `npm run validacao:check` reprova.
 *
 * Um adaptador precisa implementar:
 *
 *   compilar(especificacao) → esquemaCompilado
 *     Recebe a especificação neutra produzida por `campos.js` e devolve o que
 *     a biblioteca dele entende. O retorno é opaco: ninguém fora do adaptador
 *     inspeciona isso.
 *
 *   analisar(esquemaCompilado, dados) → { sucesso, dados?, erros? }
 *     `erros` é sempre { [caminhoDoCampo]: 'mensagem' } — formato nosso, não
 *     da biblioteca. É o que o middleware devolve como 422, então mudar de
 *     biblioteca não pode mudar o corpo da resposta que o front já trata.
 */

const METODOS = ['compilar', 'analisar'];

function conferirAdaptador(adaptador, nome = 'adaptador') {
  if (!adaptador || typeof adaptador !== 'object') {
    throw new Error(`Validação: ${nome} inválido.`);
  }

  const faltando = METODOS.filter((metodo) => typeof adaptador[metodo] !== 'function');
  if (faltando.length) {
    throw new Error(`Validação: ${nome} não implementa ${faltando.join(', ')}.`);
  }

  return adaptador;
}

module.exports = { METODOS, conferirAdaptador };
