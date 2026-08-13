'use strict';

const config = require('../config');

/**
 * Nomes de chave em um lugar só.
 *
 * Chave montada com template literal espalhada pelo projeto é o caminho curto
 * para um cache que ninguém consegue invalidar: quem grava usa
 * `anuncio:${id}` e quem apaga tenta `anuncios:${id}`. Aqui, gravar e
 * invalidar leem a mesma função.
 *
 * O prefixo com ambiente evita que homologação e produção compartilhem cache
 * quando apontam para o mesmo Redis.
 */

const base = () => `${config.redis.prefixo}:${config.app.env}`;

const chaves = {
  /** namespace para invalidar um domínio inteiro de uma vez */
  dominio: (nome) => `${base()}:${nome}:*`,

  usuario: (id) => `${base()}:usuario:${id}`,
  usuarioPermissoes: (id) => `${base()}:usuario:${id}:permissoes`,

  perfil: (slug) => `${base()}:perfil:${slug}`,
  anuncio: (id) => `${base()}:anuncio:${id}`,
  anuncioLista: (assinatura) => `${base()}:anuncios:lista:${assinatura}`,

  cep: (cep) => `${base()}:cep:${cep}`,
  geocodificacao: (lat, lon) => `${base()}:geo:${lat}:${lon}`,

  categorias: () => `${base()}:catalogo:categorias`,
  marcas: () => `${base()}:catalogo:marcas`,
  servicos: () => `${base()}:catalogo:servicos`,
  municipios: (uf) => `${base()}:catalogo:municipios:${uf}`,

  configuracoes: () => `${base()}:configuracoes`,
  termosPopulares: () => `${base()}:busca:termos-populares`,

  limite: (identificador) => `${base()}:limite:${identificador}`,
};

/**
 * Assinatura estável para consulta com filtros.
 *
 * Chaves ordenadas: `?uf=MT&q=trator` e `?q=trator&uf=MT` são a mesma busca e
 * precisam do mesmo cache — senão a taxa de acerto despenca sem ninguém notar.
 */
function assinatura(objeto = {}) {
  const partes = Object.entries(objeto)
    .filter(([, valor]) => valor !== undefined && valor !== null && valor !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chave, valor]) => `${chave}=${Array.isArray(valor) ? valor.slice().sort().join(',') : valor}`);

  return partes.join('&') || 'todos';
}

module.exports = { chaves, assinatura, base };
