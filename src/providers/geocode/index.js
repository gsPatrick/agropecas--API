'use strict';

const config = require('../../config');
const { obterJson } = require('../http');
const { arredondarCoordenada, coordenadaValida } = require('../../utils/geo');

/**
 * Provider de geocodificação reversa (BigDataCloud).
 *
 * Usado quando o anunciante manda a coordenada — GPS do aparelho ou pino no
 * mapa — e precisamos descobrir o município. Sem isso, o anúncio entraria no
 * banco sem `municipio_id` e sumiria do filtro por cidade, que é o filtro mais
 * usado do produto.
 *
 * O `reverse-geocode-client` da BigDataCloud não exige chave, o que é o motivo
 * de estar aqui: uma chave de API a mais é uma conta a mais para a cliente
 * manter e um custo por carregamento que o MVP não precisa pagar.
 *
 * **Privacidade:** a coordenada enviada ao terceiro é ARREDONDADA para 3 casas
 * (~110 m) antes de sair. Basta de sobra para acertar o município e evita
 * entregar a porteira exata de um produtor a uma empresa estrangeira.
 */

const SERVICO = 'localização por coordenada';
const TIMEOUT_MS = 4000;

/** BigDataCloud → formato interno */
const normalizar = (bruto) => {
  const uf = String(bruto.principalSubdivisionCode || '').split('-')[1] || null;

  return {
    /* `city` vem vazio em zona rural; `locality` costuma trazer o município */
    municipioNome: bruto.city || bruto.locality || null,
    uf,
    bairro: bruto.localityInfo?.administrative?.length
      ? bruto.localityInfo.administrative.slice(-1)[0]?.name || null
      : null,
    pais: bruto.countryCode || null,
    bruto,
  };
};

/**
 * Descobre município e UF a partir de uma coordenada.
 *
 * @returns {Promise<{encontrado: boolean, local: object|null}>}
 * @throws  {AppError} 503 quando o serviço está fora ou travado
 */
async function reverso(latitude, longitude) {
  if (!coordenadaValida(latitude, longitude)) return { encontrado: false, local: null };

  const lat = arredondarCoordenada(latitude);
  const lon = arredondarCoordenada(longitude);

  const url = `${config.integracoes.geocodeBaseUrl}?latitude=${lat}&longitude=${lon}&localityLanguage=pt`;
  const resposta = await obterJson(url, { servico: SERVICO, timeoutMs: TIMEOUT_MS });

  const dados = resposta.dados;
  if (!resposta.encontrado || !dados) return { encontrado: false, local: null };

  const local = normalizar(dados);

  /* fora do Brasil não interessa ao produto: devolver "Assunção/PY" faria o
     cadastro gravar uma UF que não existe na tabela de estados */
  if (local.pais && local.pais !== 'BR') return { encontrado: false, local: null };
  if (!local.municipioNome && !local.uf) return { encontrado: false, local: null };

  return { encontrado: true, local };
}

module.exports = { reverso, SERVICO, TIMEOUT_MS };
