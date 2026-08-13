'use strict';

const { erros } = require('../../../utils/erros');
const { pode } = require('../../../rbac');

/**
 * Contexto das ações do painel.
 *
 * O painel **não cria poder novo**. Quem entra continua limitado às permissões
 * que já tem — o que muda é a tela, não o RBAC. Por isso nenhum service daqui
 * chama `exigir` com permissão de admin genérica: cada operação exige a
 * permissão do recurso que ela manipula, exatamente como na feature original.
 *
 * O que o painel acrescenta é **representação**: o Admin pode agir em nome de
 * um usuário (publicar um anúncio para um produtor que ligou pedindo ajuda).
 * Isso precisa aparecer na auditoria como o que é — o Admin agindo, não o
 * produtor —, e é o que `paraTerceiro` monta.
 */

/**
 * Contexto derivado para agir representando outro usuário.
 *
 * `usuarioId` continua sendo o do Admin: trocar a identidade faria a auditoria
 * registrar o produtor como autor de uma ação que não foi dele. Quem carrega
 * a representação é `emNomeDe`, e é ele que os services gravam.
 */
function paraTerceiro(contexto, usuarioAlvoId) {
  if (!usuarioAlvoId || usuarioAlvoId === contexto.usuarioId) return contexto;

  if (!pode(contexto, 'admin.agir_em_nome_de')) {
    throw erros.semPermissao('Você não pode agir em nome de outro usuário.', {
      permissao: 'admin.agir_em_nome_de',
    });
  }

  return { ...contexto, emNomeDe: usuarioAlvoId };
}

/** exige a permissão de lote antes de qualquer operação em massa */
function garantirLote(contexto, quantidade, maximo = 100) {
  if (!pode(contexto, 'admin.operar_em_lote')) {
    throw erros.semPermissao('Você não pode aplicar ações em lote.', {
      permissao: 'admin.operar_em_lote',
    });
  }

  /* teto no lote não é burocracia: uma ação em massa sem limite é o jeito mais
     rápido de um clique errado atingir a base inteira, e não há desfazer */
  if (quantidade > maximo) {
    throw erros.invalido(`Máximo de ${maximo} registros por operação.`, {
      recebidos: quantidade,
      maximo,
    });
  }
}

module.exports = { paraTerceiro, garantirLote };
