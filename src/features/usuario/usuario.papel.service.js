'use strict';

const db = require('../../models');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const auditoria = require('../auditoria/auditoria.service');

/**
 * Atribuição e remoção de papel.
 *
 * É o ponto mais sensível do módulo: quem escreve em `usuario_papeis` decide
 * quem manda na plataforma. Três travas, todas no servidor:
 *
 * 1. **`rbac.atribuir_papel` é obrigatório** — e não há "atalho do dono": o
 *    escopo de papel é sempre `todos`.
 * 2. **Ninguém dá papel a si mesmo.** Sem isso, bastaria comprometer uma conta
 *    de moderador para ela virar admin sozinha, e a auditoria mostraria a
 *    própria vítima como autora.
 * 3. **Ninguém tira o próprio `admin`.** Um clique distraído deixaria a
 *    plataforma sem ninguém capaz de conceder o papel de volta.
 */

async function carregar(contexto, usuarioId, chavePapel) {
  exigir(contexto, 'rbac.atribuir_papel');

  if (String(usuarioId) === String(contexto.usuarioId)) {
    throw erros.semPermissao('Você não pode alterar os próprios papéis.', {
      code: 'PAPEL_SOBRE_SI_MESMO',
    });
  }

  const [usuario, papel] = await Promise.all([
    db.Usuario.findByPk(usuarioId),
    db.Papel.findOne({ where: { chave: chavePapel } }),
  ]);

  if (!usuario) throw erros.naoEncontrado('Usuário');
  if (!papel) throw erros.naoEncontrado('Papel');

  return { usuario, papel };
}

async function atribuir(contexto, usuarioId, { papel: chave, motivo, expiraEm }) {
  const { usuario, papel } = await carregar(contexto, usuarioId, chave);

  const [vinculo, criado] = await db.UsuarioPapel.findOrCreate({
    where: { usuario_id: usuario.id, papel_id: papel.id },
    defaults: {
      usuario_id: usuario.id,
      papel_id: papel.id,
      concedido_por: contexto.usuarioId,
      concedido_em: new Date(),
      expira_em: expiraEm || null,
    },
  });

  /* já tinha o papel: não é erro, mas também não vira linha nova de auditoria
     — repetir o pedido é comum quando duas abas estão abertas */
  if (!criado) return { vinculo, criado: false };

  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: 'usuario_papeis',
    entidadeId: usuario.id,
    depois: { papel: papel.chave, expira_em: expiraEm || null },
    motivo: motivo || `papel ${papel.chave} concedido`,
    emNomeDe: usuario.id,
  });

  return { vinculo, criado: true };
}

async function remover(contexto, usuarioId, chave, { motivo } = {}) {
  const { usuario, papel } = await carregar(contexto, usuarioId, chave);

  const removidos = await db.UsuarioPapel.destroy({
    where: { usuario_id: usuario.id, papel_id: papel.id },
  });

  if (!removidos) throw erros.naoEncontrado('Papel do usuário');

  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: 'usuario_papeis',
    entidadeId: usuario.id,
    antes: { papel: papel.chave },
    depois: null,
    motivo: motivo || `papel ${papel.chave} removido`,
    emNomeDe: usuario.id,
  });

  return { removido: true };
}

/** papéis atuais, sem N+1 e sem os campos da tabela de ligação */
const listarDoUsuario = (usuarioId) =>
  db.Papel.findAll({
    attributes: ['id', 'chave', 'nome', 'sistema'],
    include: [
      { model: db.Usuario, as: 'usuarios', where: { id: usuarioId }, attributes: [], through: { attributes: [] } },
    ],
  });

module.exports = { atribuir, remover, listarDoUsuario };
