'use strict';

const { campos, Campo } = require('./campos');
const { conferirAdaptador } = require('./contrato');
const { erros } = require('../utils/erros');

/**
 * Módulo de validação — base do sistema, como o RBAC. Não é feature.
 *
 * ```js
 * const { campos, esquema } = require('../../validacao');
 *
 * const login = esquema({
 *   email: campos.email().obrigatorio('Informe seu e-mail.'),
 *   senha: campos.senha().obrigatorio().min(8),
 * });
 * ```
 *
 * O que a feature enxerga é `campos` e `esquema`. A biblioteca por trás está
 * em `adaptadores/` e pode ser trocada sem que nada aqui fora saiba.
 *
 * O esquema é compilado UMA vez, quando o módulo da feature carrega — não a
 * cada requisição. Compilar por requisição é desperdício silencioso que só
 * aparece quando o tráfego chega.
 */

let adaptador = conferirAdaptador(require('./adaptadores/zod'), 'adaptador zod');

/** troca o motor de validação — usado em teste e no dia de uma migração */
function definirAdaptador(novo) {
  adaptador = conferirAdaptador(novo, 'adaptador informado');
  return adaptador;
}

const adaptadorAtual = () => adaptador;

/**
 * Compila uma definição em esquema reutilizável.
 * O objeto devolvido é opaco de propósito: só `validar` sabe abri-lo.
 */
function esquema(definicao) {
  const compilado = adaptador.compilar(definicao);
  return { __compilado: compilado, __definicao: definicao };
}

/**
 * Valida e devolve os dados **já convertidos** (número virou número, telefone
 * virou E.164, campo desconhecido foi descartado).
 *
 * Lança 422 com todos os campos de uma vez: devolver um erro por requisição
 * faria o usuário corrigir o formulário campo a campo, cada correção custando
 * uma ida ao servidor.
 */
function validar(dados, esquemaCompilado) {
  const alvo = esquemaCompilado?.__compilado || esquemaCompilado;
  const resultado = adaptador.analisar(alvo, dados);

  if (!resultado.sucesso) throw erros.validacao(resultado.erros);
  return resultado.dados;
}

/** versão que não lança — para regra de negócio que decide o que fazer */
function conferir(dados, esquemaCompilado) {
  const alvo = esquemaCompilado?.__compilado || esquemaCompilado;
  return adaptador.analisar(alvo, dados);
}

module.exports = { campos, esquema, validar, conferir, definirAdaptador, adaptadorAtual, Campo };
