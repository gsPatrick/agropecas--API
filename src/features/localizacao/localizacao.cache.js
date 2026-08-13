'use strict';

const { base, chaves: comuns } = require('../../cache/chaves');

/**
 * Chaves de cache da feature.
 *
 * `cep` e `geocodificacao` já existem no catálogo comum (`cache/chaves.js`) —
 * reaproveitadas aqui em vez de recriadas, senão gravar e invalidar passariam a
 * usar strings diferentes para a mesma coisa.
 *
 * O que é só desta feature nasce neste arquivo, conforme PADRAO_MODULO §7:
 * assim dois módulos escritos em paralelo não disputam o mesmo arquivo.
 */

const chaves = {
  /** ViaCEP — chave por CEP em dígitos puros */
  cep: (cep) => comuns.cep(cep),

  /** geocodificação reversa — coordenada JÁ arredondada pelo service */
  geocodificacao: (lat, lon) => comuns.geocodificacao(lat, lon),

  estados: () => `${base()}:catalogo:estados`,

  /** municípios por UF; a assinatura carrega busca e paginação */
  municipios: (uf, assinatura) => `${base()}:catalogo:municipios:${uf}:${assinatura}`,

  /** view pública de um endereço, já com a privacidade aplicada */
  enderecoPublico: (id) => `${base()}:endereco:publico:${id}`,

  dominio: () => `${base()}:endereco:*`,
  dominioCatalogo: () => `${base()}:catalogo:*`,
};

module.exports = { chaves };
