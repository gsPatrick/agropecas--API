'use strict';

const db = require('../../models');
const { pode, exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');

/**
 * Localizar o anúncio e decidir quem pode mexer nele.
 *
 * Existe separado porque **todo** service de escrita precisa exatamente da
 * mesma sequência — buscar, checar escopo, negar do jeito certo — e repetir
 * isso em cinco arquivos é garantir que um deles esqueça o passo do meio.
 *
 * A regra que dá nome ao arquivo: **404 e 403 são indistinguíveis para anúncio
 * de terceiro que não está publicado**. Se rascunho alheio respondesse 403 e id
 * inexistente respondesse 404, bastaria varrer UUIDs para mapear o que a
 * concorrência está preparando para lançar. Quem não pode ver, não descobre que
 * existe.
 */

/** carrega para escrita (sem includes: quem precisa deles pede depois) */
async function carregar(id) {
  return db.Anuncio.findByPk(id);
}

/**
 * Carrega e exige a ação sobre o registro.
 *
 * @param acao  ação do RBAC (`anuncio.editar`, `anuncio.publicar`…)
 */
async function paraAcao(contexto, id, acao) {
  const anuncio = await carregar(id);

  /* recurso ausente e recurso proibido devolvem a MESMA coisa */
  if (!anuncio) throw erros.naoEncontrado('Anúncio');

  if (!pode(contexto, acao, { donoId: anuncio.usuario_id })) {
    /* anúncio PUBLICADO já é público: negar com 403 não revela nada que a
       vitrine não mostre, e a mensagem honesta evita chamado de suporte.
       Fora da vitrine (rascunho, pausado, oculto), a resposta é 404 — igual à
       de um id inexistente. Distinguir os dois casos transformaria a rota num
       oráculo do que a concorrência está preparando para lançar. */
    const proprio = String(anuncio.usuario_id) === String(contexto?.usuarioId);
    if (proprio || anuncio.status === 'publicado') {
      exigir(contexto, acao, { donoId: anuncio.usuario_id });
    }
    throw erros.naoEncontrado('Anúncio');
  }

  return anuncio;
}

/** o contexto enxerga este anúncio mesmo fora da vitrine? */
const podeVerFora = (contexto, anuncio) =>
  pode(contexto, 'anuncio.ler', { donoId: anuncio.usuario_id });

/** dono do registro ou quem tem escopo total sobre ele */
const ehGestor = (contexto, anuncio) =>
  Boolean(contexto?.autenticado) && podeVerFora(contexto, anuncio);

module.exports = { carregar, paraAcao, podeVerFora, ehGestor };
