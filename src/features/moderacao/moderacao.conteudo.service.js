'use strict';

const db = require('../../models');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const {
  exigirMotivo,
  garantirNaoEhVoceMesmo,
  registrarAcao,
  carregarAnuncio,
  registrarHistoricoDoAnuncio,
  emitirModeracao,
} = require('./moderacao.comum');
const { ENTIDADE } = require('./moderacao.constants');

/**
 * Retirada de conteúdo do ar: ocultar o anúncio inteiro ou bloquear uma imagem.
 *
 * Separado de `moderacao.anuncio.service.js` porque é outro assunto: lá se
 * decide o **veredito da fila** (aprovado ou reprovado, com efeito no
 * `moderacao_status`); aqui se **retira algo do ar** por decisão pontual, sem
 * necessariamente julgar o anúncio.
 *
 * As duas ações exigem motivo. Nunca há retirada de conteúdo sem justificativa
 * gravada — é o texto que o suporte lê quando o dono liga reclamando.
 */

/** tira do ar sem apagar — o registro, as conversas e as métricas continuam */
async function ocultar(contexto, anuncioId, { motivo } = {}) {
  const anuncio = await carregarAnuncio(anuncioId);

  exigir(contexto, 'anuncio.ocultar', { donoId: anuncio.usuario_id });
  garantirNaoEhVoceMesmo(contexto, anuncio.usuario_id);
  const justificativa = exigirMotivo(motivo);

  if (anuncio.status === 'oculto') throw erros.conflito('Este anúncio já está oculto.');

  const antes = { status: anuncio.status };

  await db.sequelize.transaction(async (transacao) => {
    await anuncio.update(
      {
        status: 'oculto',
        /* volta para `em_analise` e não para `reprovado`: ocultar é uma medida
           enquanto se apura, não o veredito — quem reprova usa `reprovar` */
        moderacao_status: 'em_analise',
        moderado_por: contexto.usuarioId,
        moderado_em: new Date(),
        moderacao_motivo: justificativa,
      },
      { transaction: transacao }
    );

    await registrarHistoricoDoAnuncio(
      anuncio,
      contexto,
      { statusAnterior: antes.status, statusNovo: 'oculto', motivo: justificativa },
      transacao
    );
  });

  await registrarAcao(contexto, {
    acao: 'ocultar',
    entidade: ENTIDADE.ANUNCIO,
    entidadeId: anuncio.id,
    antes,
    depois: { status: 'oculto' },
    motivo: justificativa,
    notificar: {
      usuarioId: anuncio.usuario_id,
      tipo: 'sistema',
      titulo: 'Seu anúncio foi retirado do ar',
      mensagem: `O anúncio "${anuncio.titulo}" foi ocultado pela moderação. Motivo: ${justificativa}`,
      dados: { anuncioId: anuncio.id, motivo: justificativa },
    },
  });

  emitirModeracao(anuncio, 'oculto');
  return anuncio;
}

/**
 * Bloqueia UMA imagem.
 *
 * Existe para o caso mais comum da moderação de imagem: o anúncio é legítimo e
 * uma das oito fotos não é. Derrubar o anúncio inteiro por causa dela puniria
 * o vendedor por um erro que ele corrige em trinta segundos.
 */
async function bloquearFoto(contexto, fotoId, { motivo } = {}) {
  const foto = await db.AnuncioFoto.findByPk(fotoId, {
    include: [{ model: db.Anuncio, as: 'anuncio', attributes: ['id', 'titulo', 'status', 'usuario_id'] }],
  });
  if (!foto || !foto.anuncio) throw erros.naoEncontrado('Foto');

  exigir(contexto, 'anuncio_foto.bloquear', { donoId: foto.anuncio.usuario_id });
  garantirNaoEhVoceMesmo(contexto, foto.anuncio.usuario_id);
  const justificativa = exigirMotivo(motivo);

  if (foto.bloqueada) throw erros.conflito('Esta imagem já está bloqueada.');

  await db.sequelize.transaction(async (transacao) => {
    /* `principal: false` junto: se a imagem bloqueada continuasse sendo a capa,
       o anúncio ficaria no ar com um buraco no lugar da foto de destaque */
    await foto.update(
      { bloqueada: true, principal: false, moderada_em: new Date() },
      { transaction: transacao }
    );

    /* o histórico é do ANÚNCIO: é lá que o dono e o suporte vão procurar. O
       anúncio não mudou de estado, então `status_novo` repete o atual — a
       coluna é obrigatória e o que interessa na linha é o `alteracoes` */
    await registrarHistoricoDoAnuncio(
      foto.anuncio,
      contexto,
      {
        statusAnterior: foto.anuncio.status,
        statusNovo: foto.anuncio.status,
        motivo: justificativa,
        alteracoes: { foto_bloqueada: foto.id },
      },
      transacao
    );
  });

  await registrarAcao(contexto, {
    acao: 'ocultar',
    entidade: ENTIDADE.FOTO,
    entidadeId: foto.id,
    antes: { bloqueada: false },
    depois: { bloqueada: true, anuncio_id: foto.anuncio_id },
    motivo: justificativa,
    notificar: {
      usuarioId: foto.anuncio.usuario_id,
      tipo: 'sistema',
      titulo: 'Uma imagem do seu anúncio foi removida',
      mensagem: `Uma imagem do anúncio "${foto.anuncio.titulo}" foi bloqueada pela moderação. Motivo: ${justificativa}`,
      dados: { anuncioId: foto.anuncio_id, fotoId: foto.id, motivo: justificativa },
    },
  });

  return foto;
}

module.exports = { ocultar, bloquearFoto };
