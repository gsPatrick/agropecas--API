'use strict';

const cache = require('../../cache');
const { base } = require('../../cache/chaves');

/**
 * Chaves de cache do módulo de plano.
 *
 * Moram aqui, e não em `src/cache/chaves.js`, porque o padrão §7 manda a chave
 * nova nascer dentro da própria feature — módulos escritos em paralelo não
 * podem disputar o mesmo arquivo.
 *
 * Três prefixos, porque as três coisas envelhecem por motivos diferentes e
 * precisam ser invalidadas separadamente:
 *
 *   catalogo  → a tabela de preços do site (muda quando o Admin edita plano)
 *   limites   → plano efetivo + limites de UM usuário (muda ao atribuir plano)
 *   uso       → contador consumido (muda a cada publicação)
 *
 * Se tudo morasse num prefixo só, registrar um uso derrubaria a tabela de
 * preços pública a cada anúncio publicado.
 */

const prefixo = (assunto) => `${base()}:plano:${assunto}`;

const chaves = {
  catalogo: (assinatura) => `${prefixo('catalogo')}:${assinatura}`,

  limitesDoUsuario: (usuarioId) => `${prefixo('limites')}:${usuarioId}`,

  /* o balde entra na chave: uso de outubro e de novembro são contadores
     distintos e não podem se sobrescrever quando o mês vira */
  uso: (usuarioId, chave, balde) => `${prefixo('uso')}:${usuarioId}:${chave}:${balde}`,

  dominio: (assunto) => `${prefixo(assunto)}*`,
};

/**
 * O Admin mexeu no catálogo de planos ou nos limites de um plano.
 *
 * Derruba TAMBÉM o cache de limites de todos os usuários — deliberadamente
 * grosso. Descobrir quem assina o plano alterado exigiria uma consulta a mais
 * numa operação rara (edição de plano), enquanto reconstruir o limite de um
 * usuário é um SELECT em duas tabelas pequenas. Preferir a correção à economia
 * aqui é barato; o inverso deixaria alguém com a quota antiga até o TTL.
 */
async function invalidarPlanos() {
  await Promise.all([
    cache.invalidar(chaves.dominio('catalogo')),
    cache.invalidar(chaves.dominio('limites')),
  ]);
}

/** trocou a assinatura de uma pessoa: só o cache dela precisa cair */
const invalidarUsuario = (usuarioId) => cache.remover(chaves.limitesDoUsuario(usuarioId));

/**
 * Um uso foi registrado.
 *
 * Invalida o contador daquela chave para aquele usuário, não o balde inteiro:
 * publicar um anúncio não deve obrigar a recontar as fotos.
 */
const invalidarUso = (usuarioId, chave, balde) =>
  cache.remover(chaves.uso(usuarioId, chave, balde));

module.exports = { chaves, invalidarPlanos, invalidarUsuario, invalidarUso };
