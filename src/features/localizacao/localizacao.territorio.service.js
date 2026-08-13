'use strict';

const db = require('../../models');
const cache = require('../../cache');
const { chaves } = require('./localizacao.cache');
const { TTL } = require('./localizacao.constants');
const { normalizar } = require('../../utils/texto');
const { lerPaginacao } = require('../../utils/paginacao');

/**
 * Estado e município — as listas que alimentam os `select` do cadastro e o
 * filtro de busca.
 *
 * Tabela de referência, alimentada por seeder: muda quando o IBGE cria um
 * município, o que acontece uma vez por década. Cache longo aqui não é
 * otimização prematura — é evitar que a tela de cadastro faça um `SELECT` de
 * 142 linhas a cada carregamento, para todo mundo, todo dia.
 */

const paraEstado = (registro) => ({
  id: registro.id,
  uf: registro.uf,
  nome: registro.nome,
  codigoIbge: registro.codigo_ibge,
  regiao: registro.regiao,
});

const paraMunicipio = (registro) => ({
  id: registro.id,
  nome: registro.nome,
  uf: registro.uf,
  codigoIbge: registro.codigo_ibge,
  latitude: registro.latitude === null ? null : Number(registro.latitude),
  longitude: registro.longitude === null ? null : Number(registro.longitude),
});

async function listarEstados() {
  return cache.lembrar(
    chaves.estados(),
    async () => {
      const registros = await db.Estado.findAll({
        attributes: ['id', 'uf', 'nome', 'codigo_ibge', 'regiao'],
        order: [['nome', 'ASC']],
      });
      /* objeto simples e não instância do Sequelize: cachear instância guarda o
         `dataValues` inteiro mais o protótipo, que não sobrevive ao JSON do
         Redis */
      return registros.map(paraEstado);
    },
    { ttl: TTL.estados }
  );
}

/**
 * Municípios de uma UF, com busca por nome.
 *
 * A busca compara `nome_normalizado`: a pessoa digita "tangara" e o município
 * é "Tangará da Serra". Comparar o nome acentuado simplesmente não acha, e é o
 * tipo de bug que só aparece no interior.
 */
async function listarMunicipios(filtros = {}) {
  const uf = String(filtros.uf || 'MT').toUpperCase();
  const busca = normalizar(filtros.busca || '');
  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros, {
    porPaginaPadrao: 200,
    maximo: 500,
  });

  const assinatura = cache.assinatura({ busca, pagina, porPagina });

  return cache.lembrar(
    chaves.municipios(uf, assinatura),
    async () => {
      const where = { uf };
      if (busca) where.nome_normalizado = { [db.Sequelize.Op.like]: `${busca}%` };

      const { rows, count } = await db.Municipio.findAndCountAll({
        where,
        attributes: ['id', 'nome', 'uf', 'codigo_ibge', 'latitude', 'longitude'],
        order: [['nome', 'ASC']],
        offset,
        limit,
      });

      return { itens: rows.map(paraMunicipio), pagina, porPagina, total: count };
    },
    { ttl: TTL.municipios }
  );
}

/**
 * Resolve o município a partir do que o ViaCEP/geocoder devolveu.
 *
 * O terceiro manda o nome ("Várzea Grande") e às vezes o código IBGE. O código
 * é preferido quando existe: nome tem homônimo entre estados e sofre com
 * grafia ("Poxoréu" × "Poxoréo"). Uma consulta só, sem N+1.
 */
async function resolverMunicipio({ codigoIbge, nome, uf }) {
  if (codigoIbge) {
    const porCodigo = await db.Municipio.findOne({ where: { codigo_ibge: Number(codigoIbge) } });
    if (porCodigo) return porCodigo;
  }

  if (!nome || !uf) return null;

  return db.Municipio.findOne({
    where: { nome_normalizado: normalizar(nome), uf: String(uf).toUpperCase() },
  });
}

/** invalidação para quando o seeder rodar de novo ou o Admin corrigir a tabela */
async function invalidarCatalogo() {
  await cache.invalidar(chaves.dominioCatalogo());
}

module.exports = {
  listarEstados,
  listarMunicipios,
  resolverMunicipio,
  invalidarCatalogo,
  paraEstado,
  paraMunicipio,
};
