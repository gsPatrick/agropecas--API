'use strict';

/**
 * Registro de trabalhos: nome do job → função que executa.
 *
 * Um mapa em vez de `switch` no worker, para que adicionar trabalho seja
 * adicionar arquivo, e não editar um arquivo central que cresce sem fim.
 *
 * O trabalho recebe `(dados, contexto)` e é uma função comum — sem `req`, sem
 * `res`. É o mesmo princípio dos services: quem depende de HTTP não é
 * reaproveitável fora dele, e job é justamente o "fora dele".
 */

const trabalhos = new Map();

function registrar(nome, executor, { fila } = {}) {
  if (trabalhos.has(nome)) {
    throw new Error(`Fila: trabalho duplicado "${nome}".`);
  }
  trabalhos.set(nome, { nome, executor, fila });
  return nome;
}

const obter = (nome) => trabalhos.get(nome);

const listar = () => [...trabalhos.values()];

const daFila = (nomeDaFila) => listar().filter((t) => t.fila === nomeDaFila);

module.exports = { registrar, obter, listar, daFila };
