'use strict';

const db = require('../../models');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const auditoria = require('../auditoria/auditoria.service');
const armazenamento = require('./midia.armazenamento.service');
const { REFERENCIA_VARIANTE } = require('./midia.constants');

/**
 * Remoção — banco e disco, nessa ordem de decisão e na ordem inversa de risco.
 *
 * O que este service NÃO faz: apagar a linha de vez. `arquivos` é paranoid, e
 * o registro fica como rastro de que aquele byte existiu, de quem era e quando
 * saiu. É o que responde a um pedido de exclusão do titular ("provem que
 * apagaram") sem manter o conteúdo. O que some de verdade é o arquivo no
 * storage, que é o dado pessoal propriamente dito.
 */

/** apaga do storage o original e todas as variantes, e marca as linhas */
async function apagarConjunto(original) {
  const variantes = await db.Arquivo.findAll({
    where: { referencia_tipo: REFERENCIA_VARIANTE, referencia_id: original.id },
  });

  const alvos = [original, ...variantes];

  /* disco primeiro: se o processo cair no meio, sobra linha marcada apontando
     para arquivo inexistente — inofensivo. A ordem contrária deixaria byte no
     storage sem nenhuma linha que o encontre, que é lixo permanente */
  await Promise.all(alvos.map((linha) => armazenamento.remover(linha.path)));

  await db.Arquivo.destroy({ where: { id: alvos.map((linha) => linha.id) } });

  return { removidos: alvos.length, variantes: variantes.length };
}

async function remover(contexto, id) {
  const arquivo = await db.Arquivo.findByPk(id);

  if (!arquivo || arquivo.referencia_tipo === REFERENCIA_VARIANTE) {
    throw erros.naoEncontrado('Arquivo');
  }

  /* o escopo só pode ser conferido depois de saber de quem é o arquivo: o
     dono remove o próprio, o Admin remove o de qualquer um. É `exigir` e não
     um `if` de papel — quem tiver `arquivo.remover.todos` amanhã (moderação,
     por exemplo) passa a funcionar sem tocar nesta linha */
  exigir(contexto, 'arquivo.remover', { donoId: arquivo.usuario_id });

  const resultado = await apagarConjunto(arquivo);

  /* remoção de mídia alheia é intervenção de Admin e precisa de rastro; a
     auditoria nunca derruba a operação, o service dela já engole a falha */
  await auditoria.registrar(contexto, {
    /* `acao` é enum no banco e o vocabulário é o genérico (`remover`); quem
       diz de que domínio se trata é `entidade` */
    acao: 'remover',
    entidade: 'arquivos',
    entidadeId: arquivo.id,
    antes: { path: arquivo.path, usuarioId: arquivo.usuario_id, mime: arquivo.mime },
    motivo: String(arquivo.usuario_id) === String(contexto.usuarioId) ? 'remocao_pelo_dono' : 'remocao_administrativa',
  });

  return { id: arquivo.id, ...resultado };
}

module.exports = { remover, apagarConjunto };
