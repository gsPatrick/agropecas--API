'use strict';

const { QueryTypes } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const { erros } = require('../../utils/erros');
const { normalizar } = require('../../utils/texto');
const chavesCache = require('./busca.cache');
const { RAIO_PADRAO_KM, RAIO_MAXIMO_KM, TTL_MUNICIPIO } = require('./busca.constants');

/**
 * De onde a busca parte.
 *
 * A ordenação "mais próximo" precisa de um ponto, e o usuário informa esse
 * ponto de quatro jeitos diferentes conforme a tela: o GPS do celular manda
 * coordenada, o formulário manda CEP, o ViaCEP do front manda nome de cidade,
 * e o link compartilhado manda o id do município. Resolver isso dentro do
 * service de consulta misturaria dois assuntos.
 *
 * ─── DEPENDÊNCIA DECLARADA: módulo `localizacao` ───
 *
 * O módulo `src/features/localizacao` está sendo escrito em paralelo e é quem
 * vai saber transformar CEP em coordenada (ViaCEP/BrasilAPI + cache). Enquanto
 * ele não existe, este arquivo o carrega de forma opcional: se estiver lá, usa;
 * se não, o CEP é resolvido pelo caminho degradado (município do CEP não é
 * conhecido → 422 pedindo cidade ou coordenada), e nunca por chute.
 *
 * A integração é por CONTRATO, não por import rígido: basta o módulo exportar
 * `porCep(cep)` devolvendo `{ latitude, longitude, municipioId?, uf?, cidade? }`.
 */

/** carrega o módulo vizinho só se ele já existir — sem quebrar o boot */
function provedorDeCep() {
  try {
    /* eslint-disable-next-line global-require */
    const modulo = require('../localizacao/localizacao.cep.service');
    return typeof modulo.porCep === 'function' ? modulo : null;
  } catch (erro) {
    if (erro.code !== 'MODULE_NOT_FOUND') throw erro;
    return null;
  }
}

/**
 * Coordenada da sede do município.
 *
 * Cacheado por uma hora porque é tabela do IBGE: muda de década em década, e
 * ir ao banco a cada busca por proximidade seria uma consulta extra em 100%
 * das buscas geográficas.
 */
async function coordenadaDeMunicipio({ municipioId, cidade, uf }) {
  const alvo = cache.assinatura({ municipioId, cidade: normalizar(cidade || ''), uf });

  return cache.lembrar(
    chavesCache.chaves.municipio(alvo),
    async () => {
      const condicoes = [];
      const bind = [];

      if (municipioId) {
        bind.push(municipioId);
        condicoes.push(`m.id = $${bind.length}`);
      } else if (cidade) {
        bind.push(normalizar(cidade));
        condicoes.push(`m.nome_normalizado = $${bind.length}`);
      } else {
        return null;
      }

      if (uf) {
        bind.push(String(uf).toUpperCase());
        condicoes.push(`m.uf = $${bind.length}`);
      }

      const linhas = await db.sequelize.query(
        `SELECT m.id, m.nome, m.uf, m.latitude, m.longitude
           FROM municipios m
          WHERE ${condicoes.join(' AND ')}
          ORDER BY m.populacao DESC NULLS LAST
          LIMIT 1`,
        { bind, type: QueryTypes.SELECT }
      );

      const linha = linhas[0];
      if (!linha) return null;

      return {
        municipioId: linha.id,
        cidade: linha.nome,
        uf: linha.uf,
        latitude: linha.latitude === null ? null : Number(linha.latitude),
        longitude: linha.longitude === null ? null : Number(linha.longitude),
      };
    },
    { ttl: TTL_MUNICIPIO, cachearVazio: true }
  );
}

/**
 * Resolve o ponto de origem da busca.
 *
 * Devolve `null` quando não há como localizar — e isso NÃO é erro: a busca sem
 * proximidade continua perfeitamente válida. Só vira 422 quando o usuário pede
 * explicitamente "ordenar por mais próximo" e não deu de onde.
 */
async function resolverOrigem(filtros = {}) {
  const raioKm = Math.min(Math.max(1, Number(filtros.raioKm) || RAIO_PADRAO_KM), RAIO_MAXIMO_KM);

  /* coordenada explícita ganha de tudo: veio do GPS, é o dado mais preciso */
  if (Number.isFinite(filtros.lat) && Number.isFinite(filtros.lon)) {
    return { latitude: filtros.lat, longitude: filtros.lon, raioKm, fonte: 'coordenada' };
  }

  if (filtros.cep) {
    const provedor = provedorDeCep();
    if (provedor) {
      const ponto = await provedor.porCep(filtros.cep);
      if (ponto?.latitude && ponto?.longitude) {
        return { ...ponto, latitude: Number(ponto.latitude), longitude: Number(ponto.longitude), raioKm, fonte: 'cep' };
      }
      /* o provedor pode saber a cidade sem saber a coordenada exata */
      if (ponto?.cidade || ponto?.municipioId) {
        const sede = await coordenadaDeMunicipio(ponto);
        if (sede?.latitude) return { ...sede, raioKm, fonte: 'cep_municipio' };
      }
    }
    /* sem o módulo de localização não há de onde tirar a coordenada de um CEP;
       o front já resolve CEP → cidade pelo ViaCEP e manda `cidade` */
    return null;
  }

  if (filtros.municipioId || filtros.cidade) {
    const sede = await coordenadaDeMunicipio(filtros);
    if (sede?.latitude !== null && sede?.latitude !== undefined) {
      return { ...sede, raioKm, fonte: 'municipio' };
    }
  }

  return null;
}

/** usado quando a ordenação exige o ponto e ele não foi encontrado */
function exigirOrigem(origem) {
  if (!origem) {
    throw erros.invalido(
      'Para ordenar por proximidade, informe sua localização (coordenada ou cidade).',
      { campos: { lat: 'Informe lat/lon, cidade ou município.' } }
    );
  }
  return origem;
}

module.exports = { resolverOrigem, exigirOrigem, coordenadaDeMunicipio, provedorDeCep };
