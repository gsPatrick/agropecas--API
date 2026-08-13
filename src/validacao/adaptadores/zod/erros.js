'use strict';

/**
 * Erro do zod → formato do AgroPeças.
 *
 * `{ email: 'E-mail inválido.', 'endereco.cep': 'CEP inválido.' }`
 *
 * Existe para isolar o front: o corpo do 422 é contrato nosso. Se um dia o
 * adaptador virar joi, o front não fica sabendo.
 *
 * Um erro por campo — o primeiro. Listar todos os problemas do mesmo campo
 * enche a tela para corrigir uma coisa de cada vez.
 */
function traduzir(erroZod) {
  const campos = {};

  (erroZod?.issues || []).forEach((problema) => {
    const caminho = (problema.path || []).join('.') || '_geral';
    if (!campos[caminho]) campos[caminho] = problema.message;
  });

  return campos;
}

module.exports = { traduzir };
