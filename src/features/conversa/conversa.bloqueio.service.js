'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const auditoria = require('../auditoria/auditoria.service');
const { ACAO } = require('./conversa.constants');

/**
 * Bloqueio entre usuários.
 *
 * O bloqueio é por CONTA, nunca por IP: no interior de MT a região inteira sai
 * pelo mesmo IP de operadora, e bloquear IP tiraria vizinhos legítimos do ar.
 *
 * O efeito é simétrico — quem bloqueia e quem é bloqueado ficam sem via, nos
 * dois sentidos. O porquê está em `conversa.acesso.service.js`
 * (`existeBloqueioEntre`), que é onde a regra é aplicada.
 *
 * Bloquear **não apaga** as conversas existentes: elas continuam no banco,
 * ficam sem envio possível e seguem disponíveis para a moderação. Apagar
 * histórico no clique de bloqueio destruiria a prova de assédio bem na hora em
 * que ela passa a importar.
 */

async function bloquear(contexto, { usuarioId, motivo }) {
  exigir(contexto, 'bloqueio.gerenciar', { donoId: contexto.usuarioId });

  /* a constraint `ck_bloqueio_nao_autobloqueio` já barra isso no banco, mas
     deixar chegar lá devolveria 422 genérico de "regra violada" */
  if (String(usuarioId) === String(contexto.usuarioId)) {
    throw erros.invalido('Você não pode bloquear a si mesmo.');
  }

  const alvo = await db.Usuario.findByPk(usuarioId, { attributes: ['id', 'status'] });
  if (!alvo) throw erros.naoEncontrado('Usuário');

  const [bloqueio, criado] = await db.BloqueioUsuario.findOrCreate({
    where: { usuario_id: contexto.usuarioId, bloqueado_id: usuarioId },
    defaults: { motivo: motivo || null },
  });

  /* bloquear duas vezes é sucesso: o estado desejado já está lá, e devolver
     409 faria o front tratar erro para algo que deu certo */
  if (!criado) return { bloqueio, criado: false };

  await auditoria.registrar(contexto, {
    acao: ACAO.USUARIO_BLOQUEADO,
    entidade: 'bloqueios_usuario',
    entidadeId: bloqueio.id,
    depois: { bloqueadoId: usuarioId },
    motivo: motivo || null,
  });

  return { bloqueio, criado: true };
}

async function desbloquear(contexto, usuarioId) {
  exigir(contexto, 'bloqueio.gerenciar', { donoId: contexto.usuarioId });

  const removidos = await db.BloqueioUsuario.destroy({
    where: { usuario_id: contexto.usuarioId, bloqueado_id: usuarioId },
  });

  if (removidos) {
    await auditoria.registrar(contexto, {
      acao: ACAO.USUARIO_DESBLOQUEADO,
      entidade: 'bloqueios_usuario',
      entidadeId: null,
      depois: { bloqueadoId: usuarioId },
    });
  }

  return { desbloqueado: removidos > 0 };
}

/** só os que EU criei — o bloqueio que sofri não é informação minha */
const listar = (contexto) =>
  db.BloqueioUsuario.findAll({
    where: { usuario_id: contexto.usuarioId },
    include: [{ model: db.Usuario, as: 'bloqueado', attributes: ['id', 'nome'] }],
    order: [['criado_em', 'DESC']],
    limit: 200,
  });

/**
 * Ids que este usuário não deve ver em lugar nenhum — útil para outras
 * features (listagem de anúncios, busca) filtrarem sem repetir a regra.
 */
async function idsBloqueadosPara(usuarioId) {
  const linhas = await db.BloqueioUsuario.findAll({
    where: { [Op.or]: [{ usuario_id: usuarioId }, { bloqueado_id: usuarioId }] },
    attributes: ['usuario_id', 'bloqueado_id'],
  });

  const ids = new Set();
  linhas.forEach((linha) => {
    ids.add(String(linha.usuario_id) === String(usuarioId) ? linha.bloqueado_id : linha.usuario_id);
  });

  return [...ids];
}

module.exports = { bloquear, desbloquear, listar, idsBloqueadosPara };
