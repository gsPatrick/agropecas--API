'use strict';

const db = require('../../models');
const tempoReal = require('../../tempo-real');
const auditoria = require('../auditoria/auditoria.service');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const alvoService = require('./denuncia.alvo.service');
const { STATUS_PENDENTES, ENTIDADE } = require('./denuncia.constants');

/**
 * Abertura de denúncia — o único caminho de escrita do usuário comum nesta
 * feature.
 *
 * Duas regras dominam o arquivo:
 *
 * 1. **Idempotência por alvo.** A mesma pessoa denunciando o mesmo anúncio
 *    duas vezes não gera duas linhas. Não é só higiene: a fila de moderação é
 *    ordenada por quantidade de denúncias no alvo, então permitir repetição
 *    daria a qualquer um o poder de empurrar um concorrente para o topo da
 *    fila clicando várias vezes.
 *
 * 2. **Ninguém denuncia a si mesmo.** Não existe caso de uso legítimo, e o
 *    caso ilegítimo existe: inflar o próprio contador para depois alegar
 *    perseguição, ou apenas poluir a fila.
 */

/** o contador do anúncio é coluna (PADRÃO_MODULO §10.4) — atualizado no ato */
async function incrementarContadorDoAlvo(alvoTipo, alvoId, transacao) {
  if (alvoTipo !== 'anuncio') return;
  await db.Anuncio.increment('total_denuncias', {
    by: 1,
    where: { id: alvoId },
    transaction: transacao,
  });
}

async function criar(contexto, dados) {
  exigir(contexto, 'denuncia.criar');

  const alvo = await alvoService.resolver(dados.alvoTipo, dados.alvoId);

  if (alvo.donoId && String(alvo.donoId) === String(contexto.usuarioId)) {
    throw erros.semPermissao('Não é possível denunciar o próprio conteúdo.', {
      code: 'AUTO_DENUNCIA',
    });
  }

  /* idempotência: qualquer denúncia anterior desta pessoa sobre este alvo
     vale, inclusive já resolvida. Reabrir o mesmo caso é trabalho do
     moderador, não de quem denuncia */
  const existente = await db.Denuncia.findOne({
    where: {
      denunciante_id: contexto.usuarioId,
      alvo_tipo: dados.alvoTipo,
      alvo_id: dados.alvoId,
    },
    order: [['criado_em', 'DESC']],
  });

  if (existente) return { denuncia: existente, jaExistia: true };

  const denuncia = await db.sequelize.transaction(async (transacao) => {
    const criada = await db.Denuncia.create(
      {
        alvo_tipo: dados.alvoTipo,
        alvo_id: dados.alvoId,
        /* o autor sai do contexto, nunca do corpo (PADRÃO_MODULO §11.2) */
        denunciante_id: contexto.usuarioId,
        denunciado_id: alvo.donoId || null,
        motivo: dados.motivo,
        descricao: dados.descricao || null,
        evidencia_url: dados.evidenciaUrl || null,
        status: 'aberta',
        ip_hash: contexto.ipHash || null,
      },
      { transaction: transacao }
    );

    await incrementarContadorDoAlvo(dados.alvoTipo, dados.alvoId, transacao);
    return criada;
  });

  await auditoria.registrar(contexto, {
    acao: 'criar',
    entidade: ENTIDADE,
    entidadeId: denuncia.id,
    depois: { alvo_tipo: denuncia.alvo_tipo, alvo_id: denuncia.alvo_id, motivo: denuncia.motivo },
  });

  /* o painel de moderação atualiza sozinho. Emitir vem DEPOIS de gravar: o
     evento é entrega complementar, o registro do fato é a linha no banco */
  const abertasNoAlvo = await db.Denuncia.count({
    where: { alvo_tipo: denuncia.alvo_tipo, alvo_id: denuncia.alvo_id, status: STATUS_PENDENTES },
  });

  tempoReal.paraSala(tempoReal.salas.moderacao(), tempoReal.EVENTOS.DENUNCIA_NOVA, {
    id: denuncia.id,
    alvoTipo: denuncia.alvo_tipo,
    alvoId: denuncia.alvo_id,
    motivo: denuncia.motivo,
    /* o denunciante NÃO vai no evento: a sala `moderacao` é confiável hoje,
       mas evento é a coisa mais fácil de reencaminhar para a tela errada */
    denunciasNoAlvo: abertasNoAlvo,
    criadoEm: denuncia.criado_em,
  });

  return { denuncia, jaExistia: false };
}

module.exports = { criar };
