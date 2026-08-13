'use strict';

/**
 * API INTERNA do módulo de LGPD — o que as OUTRAS features podem usar.
 *
 * ```js
 * const lgpd = require('../lgpd');
 *
 * // o front precisa saber se deve pedir reaceite dos Termos
 * const { pendentes, bloqueia } = await lgpd.pendenciasDeAceite(usuarioId);
 *
 * // entregar um arquivo sensível sem publicar URL eterna
 * const { url } = await lgpd.link.criar({ caminho, donoId, nomeArquivo, rota: '/v1/lgpd/downloads' });
 * ```
 *
 * Nenhum service de fora deve importar os arquivos internos direto: o que está
 * aqui é o que promete continuar existindo.
 */

const documento = require('./lgpd.documento.service');
const link = require('./lgpd.link.service');
const anonimizacao = require('./lgpd.anonimizacao.service');
const constantes = require('./lgpd.constants');

module.exports = {
  /** documentos legais vigentes, por tipo */
  documentosVigentes: documento.vigentes,

  /** o usuário precisa reaceitar algum documento? */
  pendenciasDeAceite: documento.pendenciasDeAceite,

  /** entrega de arquivo por link temporário de uso único */
  link,

  /** execução da anonimização — usada pelo job; não chame no caminho HTTP */
  anonimizar: anonimizacao.executar,

  PRAZO_RESPOSTA_DIAS: constantes.PRAZO_RESPOSTA_DIAS,
  MARCADOR: constantes.MARCADOR,

  rotas: require('./lgpd.routes'),
};
