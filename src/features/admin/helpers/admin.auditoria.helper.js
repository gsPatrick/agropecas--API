'use strict';

const auditoria = require('../../auditoria/auditoria.service');

/**
 * Auditoria das ações do painel.
 *
 * Regra do projeto (documentacao/RBAC.md §2): **o preço do poder é o rastro**.
 * A cliente pediu que o Admin pudesse intervir em tudo; a contrapartida é que
 * nenhuma intervenção seja invisível.
 *
 * Este helper existe para que registrar não dependa de disciplina: os services
 * do painel chamam `registrarAcao` e o `em_nome_de` vai junto sozinho, tirado
 * do contexto. Deixar isso a cargo de cada service garantiria que um deles
 * esquecesse.
 */
const registrarAcao = (contexto, dados) =>
  auditoria.registrar(contexto, { ...dados, emNomeDe: contexto.emNomeDe || dados.emNomeDe });

/**
 * Registra uma ação em lote como UMA linha com a lista de alvos.
 *
 * Uma linha por registro afetado transformaria "suspendi 80 contas" em 80
 * entradas idênticas, e a trilha vira ruído justamente no evento que mais
 * importa revisar depois.
 */
const registrarLote = (contexto, { acao, entidade, ids, motivo, resultado }) =>
  registrarAcao(contexto, {
    acao,
    entidade,
    entidadeId: null,
    motivo,
    depois: { emLote: true, total: ids.length, ids: ids.slice(0, 200), resultado },
  });

module.exports = { registrarAcao, registrarLote };
