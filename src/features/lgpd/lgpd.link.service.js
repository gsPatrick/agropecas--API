'use strict';

const fs = require('fs/promises');
const path = require('path');
const cache = require('../../cache');
const config = require('../../config');
const storage = require('../../providers/storage');
const { erros } = require('../../utils/erros');
const { gerarToken } = require('../../utils/hash');
const { chaves } = require('./lgpd.cache');
const { LINK_MINUTOS } = require('./lgpd.constants');

/**
 * Link temporário de uso único para entrega de arquivo sensível.
 *
 * Existe porque o resultado de uma exportação não pode ser servido por URL
 * pública do storage: essa URL não expira, não é revogável e vaza inteira em
 * qualquer histórico de navegador, log de proxy ou encaminhamento de e-mail.
 * O que sai daqui é um bilhete opaco, com dono, prazo e uma única utilização.
 *
 * Usado pelo export de LGPD e pelo export da trilha de auditoria — os dois
 * casos em que a API entrega um arquivo com dado de gente.
 *
 * O consumo é feito ANTES de ler o arquivo (`remover` antes do `readFile`):
 * dois cliques simultâneos no mesmo link precisam resultar em um download e um
 * 404, nunca em dois downloads.
 */

/**
 * @param dono         quem pode resgatar; ninguém mais consegue, nem o Admin
 * @param minutos      validade
 * @returns {{token, url, expiraEm}}
 */
async function criar({ caminho, donoId, nomeArquivo, mime = 'application/json', rota, minutos = LINK_MINUTOS }) {
  const token = gerarToken(32);
  const expiraEm = new Date(Date.now() + minutos * 60 * 1000);

  const gravou = await cache.gravar(
    chaves.download(token),
    { caminho, donoId: donoId ? String(donoId) : null, nomeArquivo, mime, expiraEm: expiraEm.toISOString() },
    { ttl: minutos * 60 }
  );

  if (!gravou) {
    /* sem cache não há como expirar nem invalidar o bilhete; entregar um link
       eterno seria pior do que falhar a entrega */
    throw erros.interno('Não foi possível preparar o link de download. Tente novamente.');
  }

  return {
    token,
    url: `${config.app.webUrl}${config.app.apiPrefix}${rota}/${token}`,
    expiraEm,
  };
}

/**
 * Resgata e QUEIMA o bilhete.
 *
 * 404 tanto para inexistente quanto para "não é seu": distinguir os dois
 * transformaria o endpoint num oráculo que confirma a existência de exports
 * alheios.
 */
async function resgatar(token, contexto) {
  const bilhete = await cache.obter(chaves.download(token));
  if (!bilhete) throw erros.naoEncontrado('Arquivo');

  if (bilhete.donoId && String(bilhete.donoId) !== String(contexto?.usuarioId)) {
    throw erros.naoEncontrado('Arquivo');
  }

  /* uso único: queima antes de servir */
  await cache.remover(chaves.download(token));

  const absoluto = path.join(config.storage.localPath, bilhete.caminho);
  const raiz = path.resolve(config.storage.localPath);
  if (!path.resolve(absoluto).startsWith(raiz)) throw erros.naoEncontrado('Arquivo');

  const conteudo = await fs.readFile(absoluto).catch(() => null);
  if (!conteudo) throw erros.naoEncontrado('Arquivo');

  return { conteudo, nomeArquivo: bilhete.nomeArquivo, mime: bilhete.mime };
}

/** grava o pacote no storage e devolve o caminho relativo */
const guardar = (buffer, { pasta = 'lgpd', extensao = 'json' } = {}) =>
  storage.salvar(buffer, { pasta, extensao });

module.exports = { criar, resgatar, guardar };
