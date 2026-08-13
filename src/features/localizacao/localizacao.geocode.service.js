'use strict';

const cache = require('../../cache');
const geocode = require('../../providers/geocode');
const territorio = require('./localizacao.territorio.service');
const { chaves } = require('./localizacao.cache');
const { TTL } = require('./localizacao.constants');
const { arredondarCoordenada, coordenadaValida } = require('../../utils/geo');
const { erros } = require('../../utils/erros');

/**
 * Geocodificação reversa: coordenada → município.
 *
 * É o que sustenta duas das três origens de endereço do documento da cliente
 * (Maturacao/05 §9.1): coordenada colada do WhatsApp e pino arrastado no mapa.
 * Nas duas, o anunciante não sabe (nem precisa saber) o endereço formal — mas o
 * sistema precisa do município, porque é por município que se busca.
 *
 * A chave de cache usa a coordenada ARREDONDADA para 3 casas (~110 m). Duas
 * decisões numa só: a taxa de acerto sobe muito (um GPS nunca devolve o mesmo
 * ponto duas vezes) e a coordenada exata do produtor não vira chave de Redis.
 */

async function reverter(latitude, longitude) {
  if (!coordenadaValida(latitude, longitude)) {
    throw erros.invalido('Coordenada inválida.', { campos: ['latitude', 'longitude'] });
  }

  const lat = arredondarCoordenada(latitude);
  const lon = arredondarCoordenada(longitude);
  const chave = chaves.geocodificacao(lat, lon);

  const guardado = await cache.obter(chave);
  if (guardado !== undefined) return { ...guardado, origemCache: true };

  const { encontrado, local } = await geocode.reverso(lat, lon);

  if (!encontrado) {
    const vazio = { encontrado: false, endereco: null };
    await cache.gravar(chave, vazio, { ttl: TTL.geocodificacao });
    return { ...vazio, origemCache: false };
  }

  const municipio = await territorio.resolverMunicipio({
    nome: local.municipioNome,
    uf: local.uf,
  });

  const resultado = {
    encontrado: true,
    endereco: {
      cep: null,
      logradouro: null,
      bairro: local.bairro,
      municipioId: municipio ? municipio.id : null,
      municipioNome: municipio ? municipio.nome : local.municipioNome,
      uf: local.uf,
      /* a coordenada devolvida é a do USUÁRIO, não a da sede do município: ele
         apontou o lugar, e substituir isso pela cidade jogaria fora justamente
         a precisão que o pino no mapa existe para dar */
      latitude: Number(latitude),
      longitude: Number(longitude),
      precisao: 'exata',
      origem: 'coordenada',
    },
    retornoBruto: local.bruto,
  };

  await cache.gravar(chave, resultado, { ttl: TTL.geocodificacao });
  return { ...resultado, origemCache: false };
}

module.exports = { reverter };
