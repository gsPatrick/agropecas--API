'use strict';

const papelService = require('../../usuario/usuario.papel.service');
const compartilhado = require('./admin.shared');

/**
 * Papéis de um usuário, pela tela do painel.
 *
 * O arquivo é curto porque **deve ser curto**. Escrever em `usuario_papeis` é
 * decidir quem manda na plataforma, e as três travas que protegem isso
 * (`rbac.atribuir_papel` obrigatório, ninguém dá papel a si mesmo, ninguém tira
 * o próprio `admin`) já moram em `usuario.papel.service`. Uma segunda
 * implementação delas aqui seria uma segunda superfície para revisar — e a que
 * ninguém revisa é a que vaza.
 *
 * O painel só acrescenta a invalidação do resumo: papel novo muda o que o
 * próximo card de "quem administra" mostra.
 */

const listar = (contexto, usuarioId) => papelService.listarDoUsuario(usuarioId);

async function atribuir(contexto, usuarioId, dados = {}) {
  const { criado } = await papelService.atribuir(contexto, usuarioId, dados);
  const papeis = await papelService.listarDoUsuario(usuarioId);

  await compartilhado.invalidarPainel();
  return { papeis, criado };
}

async function remover(contexto, usuarioId, chave, dados = {}) {
  await papelService.remover(contexto, usuarioId, chave, dados);
  const papeis = await papelService.listarDoUsuario(usuarioId);

  await compartilhado.invalidarPainel();
  return { papeis };
}

module.exports = { listar, atribuir, remover };
