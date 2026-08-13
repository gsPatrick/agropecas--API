'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const auditoria = require('../auditoria/auditoria.service');
const { erros } = require('../../utils/erros');
const { normalizar } = require('../../utils/texto');
const mapper = require('./catalogo.mapper');
const chavesCache = require('./catalogo.cache');
const { TTL_CATALOGO, ENTIDADE } = require('./catalogo.constants');
const { slugUnico, filtroBusca, comConflitoTratado, somenteInformados } = require('./catalogo.comum');

/**
 * Marcas — fabricante de máquina ou de peça (John Deere, Bosch, Valtra).
 *
 * Alimenta dois lugares: o select "marca" do anúncio e o filtro da busca. A
 * lista é curta e quase imutável, por isso é servida do cache com TTL longo.
 */

const COLUNAS = ['id', 'nome', 'slug', 'logo_url', 'tipo', 'ordem', 'ativo'];

const ORDEM = [
  ['ordem', 'ASC'],
  ['nome', 'ASC'],
];

/**
 * Listagem cacheada.
 *
 * Cacheia o resultado JÁ mapeado e com o total: gravar a instância do Sequelize
 * quebraria na volta do Redis, e recontar a cada acerto de cache desperdiçaria
 * o que o cache economizou.
 */
async function listar({ busca, tipo, incluirInativas = false } = {}, { limit, offset }) {
  const assinatura = cache.assinatura({ busca, tipo, inativas: incluirInativas, limit, offset });

  return cache.lembrar(
    chavesCache.chaves.marcas(assinatura),
    async () => {
      const where = {};
      if (!incluirInativas) where.ativo = true;
      if (tipo) where.tipo = { [Op.in]: [tipo, 'ambos'] };

      const porNome = filtroBusca('nome_normalizado', busca);
      if (porNome) Object.assign(where, porNome);

      const { rows, count } = await db.Marca.findAndCountAll({
        where,
        attributes: COLUNAS,
        order: ORDEM,
        limit,
        offset,
        raw: true,
      });

      return { itens: rows.map(mapper.marca), total: count };
    },
    { ttl: TTL_CATALOGO }
  );
}

async function porSlug(slug) {
  const registro = await db.Marca.findOne({ where: { slug }, attributes: COLUNAS, raw: true });
  if (!registro) throw erros.naoEncontrado('Marca');
  return mapper.marca(registro);
}

async function criar(contexto, corpo) {
  const slug = await slugUnico(db.Marca, corpo.slug || corpo.nome);

  const registro = await comConflitoTratado('uma marca', () =>
    db.Marca.create({
      nome: corpo.nome,
      nome_normalizado: normalizar(corpo.nome),
      slug,
      logo_url: corpo.logoUrl || null,
      tipo: corpo.tipo || 'ambos',
      ordem: corpo.ordem ?? 0,
      ativo: corpo.ativo ?? true,
    })
  );

  await chavesCache.invalidarMarcas();
  await auditoria.registrar(contexto, {
    acao: 'criar',
    entidade: ENTIDADE.MARCA,
    entidadeId: registro.id,
    depois: mapper.marca(registro),
  });

  return mapper.marca(registro);
}

const MAPA_EDICAO = {
  nome: 'nome',
  logoUrl: 'logo_url',
  tipo: 'tipo',
  ordem: 'ordem',
  ativo: 'ativo',
};

async function editar(contexto, id, corpo) {
  const registro = await db.Marca.findByPk(id);
  if (!registro) throw erros.naoEncontrado('Marca');

  const antes = mapper.marca(registro);
  const mudancas = somenteInformados(corpo, MAPA_EDICAO);
  if (corpo.nome !== undefined) mudancas.nome_normalizado = normalizar(corpo.nome);

  /* slug preso ao criar, como em categoria: ele vive em URL pública */
  if (corpo.regerarSlug && corpo.nome) {
    mudancas.slug = await slugUnico(db.Marca, corpo.nome, { ignorarId: registro.id });
  }

  await comConflitoTratado('uma marca', () => registro.update(mudancas));

  await chavesCache.invalidarMarcas();
  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: ENTIDADE.MARCA,
    entidadeId: registro.id,
    antes,
    depois: mapper.marca(registro),
  });

  return mapper.marca(registro);
}

/**
 * Remoção segura.
 *
 * Marca é referenciada por máquina, anúncio e perfil (as marcas que a loja
 * trabalha). A FK de anúncio é `SET NULL`: apagar em silêncio deixaria o
 * anúncio sem marca e fora do filtro. Desativar é quase sempre o que o Admin
 * realmente quer, e o detalhe do 409 diz isso.
 */
async function remover(contexto, id) {
  const registro = await db.Marca.findByPk(id);
  if (!registro) throw erros.naoEncontrado('Marca');

  const [maquinas, anuncios, perfis] = await Promise.all([
    db.Maquina.count({ where: { marca_id: registro.id } }),
    db.Anuncio.count({ where: { marca_id: registro.id } }),
    db.PerfilMarca.count({ where: { marca_id: registro.id } }),
  ]);

  if (maquinas || anuncios || perfis) {
    throw erros.conflito(
      'Esta marca ainda está em uso e não pode ser removida. Desative a marca para tirá-la dos formulários sem perder o vínculo.',
      { maquinas, anuncios, perfis, sugestao: 'ativo: false' }
    );
  }

  await registro.destroy();

  await chavesCache.invalidarMarcas();
  await auditoria.registrar(contexto, {
    acao: 'remover',
    entidade: ENTIDADE.MARCA,
    entidadeId: registro.id,
    antes: mapper.marca(registro),
  });

  return { removida: true, id: registro.id };
}

module.exports = { listar, porSlug, criar, editar, remover };
