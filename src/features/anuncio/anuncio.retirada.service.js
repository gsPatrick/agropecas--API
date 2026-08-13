'use strict';

const db = require('../../models');
const filas = require('../../filas');
const auditoria = require('../auditoria/auditoria.service');
const acesso = require('./anuncio.acesso.service');
const historico = require('./anuncio.historico.service');
const campos = require('./anuncio.campos');
const { garantirTransicao } = require('./anuncio.publicacao.service');

/**
 * Saída do ar: ocultar (moderação) e remover (exclusão pelo dono).
 *
 * As duas são separadas de propósito. **Ocultar** é ato da plataforma sobre
 * conteúdo impróprio e exige motivo — sem ele o anunciante não tem como
 * corrigir nem contestar, e a moderação vira arbítrio. **Remover** é decisão do
 * dono sobre o próprio anúncio e não precisa justificar nada a ninguém.
 *
 * Nenhuma das duas apaga a linha de verdade: o soft delete mantém conversas,
 * denúncias e auditoria apontando para um registro que existe. Apagar
 * transformaria a trilha em ponteiro quebrado justamente nos casos em que ela
 * é necessária.
 */

async function ocultar(contexto, id, { motivo }) {
  const anuncio = await acesso.paraAcao(contexto, id, 'anuncio.ocultar');
  const para = garantirTransicao('ocultar', anuncio);
  const de = anuncio.status;

  await db.sequelize.transaction(async (transacao) => {
    await anuncio.update(
      {
        status: para,
        moderacao_status: 'reprovado',
        moderacao_motivo: motivo,
        moderado_por: contexto.usuarioId,
        moderado_em: new Date(),
      },
      { transaction: transacao }
    );
    await historico.registrar(anuncio, { de, para, contexto, motivo, transacao });
    await historico.ajustarContadorDoPerfil(anuncio, { de, para }, transacao);
  });

  await auditoria.registrar(contexto, {
    acao: 'ocultar',
    entidade: 'anuncios',
    entidadeId: anuncio.id,
    emNomeDe: anuncio.usuario_id,
    motivo,
    antes: { status: de },
    depois: { status: para },
  });

  /* o motivo vai na notificação: o anunciante precisa saber o que corrigir,
     e um aviso "seu anúncio saiu do ar" sem razão gera ticket de suporte */
  await filas.enfileirar('notificacao.criar', {
    usuarioId: anuncio.usuario_id,
    tipo: 'anuncio_reprovado',
    titulo: 'Seu anúncio foi ocultado',
    mensagem: motivo,
    dados: { anuncioId: anuncio.id, motivo },
    entidade: 'anuncios',
    entidadeId: anuncio.id,
    canais: ['sistema'],
  });

  await campos.invalidar(anuncio.id);
  return anuncio;
}

async function remover(contexto, id, { motivo } = {}) {
  const anuncio = await acesso.paraAcao(contexto, id, 'anuncio.remover');
  const de = anuncio.status;

  await db.sequelize.transaction(async (transacao) => {
    await anuncio.update({ status: 'removido' }, { transaction: transacao });
    await historico.registrar(anuncio, { de, para: 'removido', contexto, motivo, transacao });
    await historico.ajustarContadorDoPerfil(anuncio, { de, para: 'removido' }, transacao);
    /* `paranoid` do model: preenche `removido_em` e some das consultas, sem
       DELETE físico */
    await anuncio.destroy({ transaction: transacao });
  });

  await auditoria.registrar(contexto, {
    acao: 'remover',
    entidade: 'anuncios',
    entidadeId: anuncio.id,
    emNomeDe: String(anuncio.usuario_id) !== String(contexto.usuarioId) ? anuncio.usuario_id : null,
    motivo,
    antes: { status: de, titulo: anuncio.titulo },
  });

  await campos.invalidar(anuncio.id);
  return { removido: true };
}

module.exports = { ocultar, remover };
