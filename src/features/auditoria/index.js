'use strict';

const servico = require('./auditoria.service');
const { RECURSO_ACESSO, RECURSOS_ACESSO } = require('./auditoria.constants');

/**
 * API INTERNA do módulo — é isto que as outras onze features usam.
 *
 * ```js
 * const auditoria = require('../auditoria');
 *
 * // alguém MUDOU alguma coisa
 * await auditoria.registrar(ctx, {
 *   acao: 'remover', entidade: 'anuncio', entidadeId: anuncio.id,
 *   antes: anuncio.get({ plain: true }), motivo: 'denúncia procedente',
 * });
 *
 * // alguém LEU dado pessoal de terceiro
 * await auditoria.registrarAcessoDado(ctx, {
 *   titularId: conversa.interessado_id,
 *   recurso: auditoria.RECURSO_ACESSO.CONVERSA,
 *   recursoId: conversa.id,
 *   motivo: 'análise da denúncia #' + denuncia.id,
 * });
 * ```
 *
 * As duas funções **nunca lançam** e nunca precisam de `try/catch` em volta.
 * Nenhuma delas devolve algo que valha a pena conferir — se um dia um `if` no
 * retorno de uma delas decidir o rumo de uma operação de negócio, o contrato
 * foi mal entendido: auditoria observa, não decide.
 *
 * Contrato detalhado, com as regras de uso: `documentacao/features/Auditoria.md`.
 */
module.exports = {
  registrar: servico.registrar,
  registrarAcessoDado: servico.registrarAcessoDado,
  registrarAcessoEmLote: servico.registrarAcessoEmLote,

  /** vocabulário fechado de `recurso` — use as constantes, não strings soltas */
  RECURSO_ACESSO,
  RECURSOS_ACESSO,

  rotas: require('./auditoria.routes'),
};
