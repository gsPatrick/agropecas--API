'use strict';

const { exigir } = require('../../rbac');
const auditoria = require('../auditoria/auditoria.service');
const cachePerfil = require('./perfil.cache');

/**
 * Selo de verificação — o "este cadastro foi conferido pela plataforma".
 *
 * Existe um service só para isto por um motivo de segurança, não de
 * organização: `verificado_em` e `verificado_por` são as ÚNICAS colunas do
 * perfil que o próprio dono não pode escrever. Se elas morassem no caminho de
 * edição, bastaria um campo a mais no esquema para que qualquer usuário se
 * auto-verificasse mandando `verificadoEm` no corpo.
 *
 * Aqui os dois valores nunca vêm da requisição: `verificado_por` é sempre
 * `contexto.usuarioId` e `verificado_em` é sempre o relógio do servidor. Não há
 * argumento que os influencie.
 *
 * A capacidade `perfil.verificar` só existe com escopo `todos` — ver
 * `src/rbac/recursos.js`. Ninguém tem "verificar o próprio".
 */

async function verificar(perfil, { observacao }, contexto) {
  exigir(contexto, 'perfil.verificar', { donoId: perfil.usuario_id });

  const antes = {
    verificado_em: perfil.verificado_em,
    verificado_por: perfil.verificado_por,
  };

  await perfil.update({
    verificado_em: new Date(),
    verificado_por: contexto.usuarioId,
    verificacao_observacao: observacao,
  });

  await cachePerfil.invalidar(perfil);

  /* verificação é atestado público da plataforma sobre um terceiro: quem
     assinou e por quê precisa ficar registrado para quando alguém contestar */
  await auditoria.registrar(contexto, {
    acao: 'aprovar',
    entidade: 'perfis',
    entidadeId: perfil.id,
    antes,
    depois: { verificado_em: perfil.verificado_em, verificado_por: perfil.verificado_por },
    motivo: observacao,
    emNomeDe: perfil.usuario_id,
  });

  return perfil;
}

/** retirar o selo é tão sensível quanto dá-lo — mesma capacidade, mesmo rastro */
async function revogar(perfil, { motivo } = {}, contexto) {
  exigir(contexto, 'perfil.verificar', { donoId: perfil.usuario_id });

  const antes = {
    verificado_em: perfil.verificado_em,
    verificado_por: perfil.verificado_por,
  };

  await perfil.update({
    verificado_em: null,
    verificado_por: null,
    verificacao_observacao: motivo || null,
  });

  await cachePerfil.invalidar(perfil);

  await auditoria.registrar(contexto, {
    acao: 'reprovar',
    entidade: 'perfis',
    entidadeId: perfil.id,
    antes,
    depois: { verificado_em: null, verificado_por: null },
    motivo: motivo || 'selo de verificação revogado',
    emNomeDe: perfil.usuario_id,
  });

  return perfil;
}

module.exports = { verificar, revogar };
