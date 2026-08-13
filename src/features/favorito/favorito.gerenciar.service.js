'use strict';

const db = require('../../models');
const { erros } = require('../../utils/erros');
const { COLUNAS_ANUNCIO } = require('./favorito.constants');

/**
 * Escrita de favorito: salvar e remover.
 *
 * Separado da consulta porque são dois assuntos com riscos diferentes — aqui o
 * que importa é idempotência e contador correto; lá, volume e N+1.
 *
 * O service não conhece `req`: recebe `contexto` e dados simples, para poder
 * ser chamado de um job (importar favoritos de uma conta migrada, por exemplo).
 */

/**
 * Carrega o anúncio alvo.
 *
 * `findByPk` respeita o `paranoid` do model, então anúncio removido já não
 * aparece — é o mesmo motivo pelo qual a listagem não precisa de filtro
 * explícito de exclusão.
 */
async function exigirAnuncio(anuncioId) {
  const anuncio = await db.Anuncio.findByPk(anuncioId, {
    attributes: ['id', 'usuario_id', 'status'],
  });
  if (!anuncio) throw erros.naoEncontrado('Anúncio');
  return anuncio;
}

/**
 * Salva o anúncio na lista do usuário.
 *
 * **Idempotente por construção.** O índice único (`usuario_id`, `anuncio_id`)
 * é a garantia real; `findOrCreate` é o caminho feliz. Favoritar duas vezes é
 * o comportamento normal de um coração que o usuário clica duas vezes com a
 * rede lenta, não um erro — devolver 409 aí faria o front tratar exceção para
 * um caso que não é excepcional.
 *
 * `total_favoritos` só sobe quando a linha nasceu. Sem essa condição, o
 * duplo clique inflaria o contador que o dono do anúncio usa para decidir se
 * o preço está bom.
 *
 * @returns {{favorito, criado: boolean}}
 */
async function salvar(contexto, { anuncioId, anotacao }) {
  await exigirAnuncio(anuncioId);

  const resultado = await db.sequelize.transaction(async (transacao) => {
    const [favorito, criado] = await db.Favorito.findOrCreate({
      where: { usuario_id: contexto.usuarioId, anuncio_id: anuncioId },
      defaults: { usuario_id: contexto.usuarioId, anuncio_id: anuncioId, anotacao: anotacao || null },
      transaction: transacao,
    });

    if (criado) {
      /* increment e não leia-some-grave: dois cliques simultâneos no mesmo
         anúncio, em instâncias diferentes, perderiam uma contagem */
      await db.Anuncio.increment('total_favoritos', {
        by: 1,
        where: { id: anuncioId },
        transaction: transacao,
      });
    } else if (anotacao !== undefined && anotacao !== favorito.anotacao) {
      /* re-salvar com anotação nova é o jeito natural de editar o lembrete,
         e não vale um endpoint próprio para um campo de 255 caracteres */
      await favorito.update({ anotacao: anotacao || null }, { transaction: transacao });
    }

    return { favorito, criado };
  });

  /* recarrega com o card do anúncio já pronto: o front que acabou de salvar
     costuma renderizar o item na lista lateral sem recarregar a página, e
     devolver só o id o obrigaria a uma segunda chamada */
  const favorito = await db.Favorito.findByPk(resultado.favorito.id, {
    include: [
      {
        model: db.Anuncio,
        as: 'anuncio',
        required: false,
        attributes: COLUNAS_ANUNCIO,
        include: [
          {
            model: db.AnuncioFoto,
            as: 'fotos',
            required: false,
            where: { principal: true },
            attributes: ['id', 'url', 'url_thumb'],
          },
        ],
      },
    ],
  });

  return { favorito: favorito || resultado.favorito, criado: resultado.criado };
}

/**
 * Tira o anúncio da lista.
 *
 * Também idempotente: desfavoritar o que já não está salvo devolve
 * `removido: false` e 204, sem 404. O usuário pediu "não quero mais este
 * item salvo" e o estado final é exatamente esse — inventar erro aqui só
 * geraria tela de falha para uma operação que deu certo.
 *
 * O `where` carrega `usuario_id` do contexto, então não existe caminho para
 * remover favorito alheio nem com o id certo em mãos.
 */
async function remover(contexto, { anuncioId }) {
  return db.sequelize.transaction(async (transacao) => {
    const removidos = await db.Favorito.destroy({
      where: { usuario_id: contexto.usuarioId, anuncio_id: anuncioId },
      transaction: transacao,
    });

    if (removidos) {
      /* o `where` extra impede o contador de ir a negativo se o anúncio já
         estiver zerado por uma correção manual no banco */
      await db.Anuncio.decrement('total_favoritos', {
        by: 1,
        where: { id: anuncioId, total_favoritos: { [db.Sequelize.Op.gt]: 0 } },
        transaction: transacao,
      });
    }

    return { removido: Boolean(removidos) };
  });
}

module.exports = { salvar, remover, exigirAnuncio };
