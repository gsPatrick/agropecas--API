'use strict';

const { base } = require('../../cache/chaves');

/**
 * Chaves de cache da feature.
 *
 * Moram aqui, e não em `cache/chaves.js`, porque onze módulos estão sendo
 * escritos em paralelo e um arquivo central seria conflito de merge garantido.
 * O prefixo comum (`base()`) continua sendo o mesmo — é ele que mantém
 * ambientes separados no mesmo Redis.
 *
 * Regra desta feature: **toda escrita invalida o detalhe do anúncio e o
 * domínio das listas**. Lista com filtro tem assinatura própria e seria
 * impossível saber quais dela um anúncio novo afeta — apagar o prefixo inteiro
 * é mais barato do que servir vitrine errada.
 */

const chaves = {
  detalhe: (id) => `${base()}:anuncio:${id}`,
  lista: (assinatura) => `${base()}:anuncios:lista:${assinatura}`,
  parecidos: (id) => `${base()}:anuncios:parecidos:${id}`,

  /** padrão de invalidação em massa das listagens públicas */
  dominioListas: () => `${base()}:anuncios:*`,

  /**
   * Janela antiflood da visualização.
   * A chave junta anúncio + hash de IP: é o par que identifica "a mesma pessoa
   * no mesmo anúncio" sem guardar IP em claro em lugar nenhum (LGPD).
   */
  visita: (anuncioId, ipHash) => `${base()}:anuncio:${anuncioId}:visita:${ipHash}`,

  configuracao: (chave) => `${base()}:configuracao:${chave}`,
  limitePlano: (usuarioId) => `${base()}:anuncio:limite:${usuarioId}`,
};

module.exports = { chaves };
