'use strict';

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
 * Máquinas — modelo de maquinário, sempre pendurado numa marca.
 *
 * Sustenta o "Busque por máquina", que é a porta de entrada de quem não sabe o
 * nome da peça mas sabe o trator que tem. Por isso a busca por modelo importa
 * mais aqui do que nos outros assuntos: o índice trigrama em
 * `modelo_normalizado` existe justamente para o `%termo%` desta consulta.
 */

const COLUNAS = [
  'id',
  'marca_id',
  'modelo',
  'slug',
  'categoria_maquina',
  'ano_inicio',
  'ano_fim',
  'potencia_cv',
  'observacao',
  'ativo',
];

/**
 * Listagem, opcionalmente presa a uma marca.
 *
 * O `include` da marca vem com `raw: true` e colunas explícitas: sem isso,
 * cada máquina traria a marca inteira e a lista de 400 modelos carregaria 400
 * cópias do mesmo logo_url pela rede.
 */
async function listar({ busca, marcaId, categoriaMaquina, incluirInativas = false } = {}, { limit, offset }) {
  const assinatura = cache.assinatura({
    busca,
    marcaId,
    categoriaMaquina,
    inativas: incluirInativas,
    limit,
    offset,
  });

  return cache.lembrar(
    chavesCache.chaves.maquinas(assinatura),
    async () => {
      const where = {};
      if (!incluirInativas) where.ativo = true;
      if (marcaId) where.marca_id = marcaId;
      if (categoriaMaquina) where.categoria_maquina = categoriaMaquina;

      const porModelo = filtroBusca('modelo_normalizado', busca);
      if (porModelo) Object.assign(where, porModelo);

      const { rows, count } = await db.Maquina.findAndCountAll({
        where,
        attributes: COLUNAS,
        include: [{ model: db.Marca, as: 'marca', attributes: ['id', 'nome', 'slug'], required: false }],
        order: [
          [{ model: db.Marca, as: 'marca' }, 'nome', 'ASC'],
          ['modelo', 'ASC'],
        ],
        limit,
        offset,
        raw: true,
        /* `findAndCountAll` com include conta linhas duplicadas quando a relação
           é 1-N; aqui é N-1 (uma marca por máquina), então `distinct` não é
           necessário — mas `subQuery: false` mantém o LIMIT no SQL de fora */
        subQuery: false,
      });

      return { itens: rows.map(mapper.maquina), total: count };
    },
    { ttl: TTL_CATALOGO }
  );
}

async function porSlug(slug) {
  const registro = await db.Maquina.findOne({
    where: { slug },
    attributes: COLUNAS,
    include: [{ model: db.Marca, as: 'marca', attributes: ['id', 'nome', 'slug'] }],
    raw: true,
  });
  if (!registro) throw erros.naoEncontrado('Máquina');
  return mapper.maquina(registro);
}

/** anos incoerentes passariam pelo banco e só apareceriam como filtro vazio */
function conferirAnos({ anoInicio, anoFim }) {
  if (anoInicio && anoFim && anoFim < anoInicio) {
    throw erros.invalido('O ano final não pode ser anterior ao ano inicial.');
  }
}

async function criar(contexto, corpo) {
  const marca = await db.Marca.findByPk(corpo.marcaId, { attributes: ['id', 'nome'] });
  if (!marca) throw erros.invalido('A marca informada não existe.');
  conferirAnos(corpo);

  /* o slug carrega a marca: "6110j" sozinho colidiria entre fabricantes e não
     diria nada em uma URL */
  const slug = await slugUnico(db.Maquina, corpo.slug || `${marca.nome} ${corpo.modelo}`);

  const registro = await comConflitoTratado('uma máquina', () =>
    db.Maquina.create({
      marca_id: marca.id,
      modelo: corpo.modelo,
      modelo_normalizado: normalizar(corpo.modelo),
      slug,
      categoria_maquina: corpo.categoriaMaquina || 'trator',
      ano_inicio: corpo.anoInicio ?? null,
      ano_fim: corpo.anoFim ?? null,
      potencia_cv: corpo.potenciaCv ?? null,
      observacao: corpo.observacao || null,
      ativo: corpo.ativo ?? true,
    })
  );

  await chavesCache.invalidarMaquinas();
  await auditoria.registrar(contexto, {
    acao: 'criar',
    entidade: ENTIDADE.MAQUINA,
    entidadeId: registro.id,
    depois: mapper.maquina(registro),
  });

  return mapper.maquina({ ...registro.get(), marca: marca.get() });
}

const MAPA_EDICAO = {
  modelo: 'modelo',
  categoriaMaquina: 'categoria_maquina',
  anoInicio: 'ano_inicio',
  anoFim: 'ano_fim',
  potenciaCv: 'potencia_cv',
  observacao: 'observacao',
  ativo: 'ativo',
};

async function editar(contexto, id, corpo) {
  const registro = await db.Maquina.findByPk(id);
  if (!registro) throw erros.naoEncontrado('Máquina');

  if (corpo.marcaId && !(await db.Marca.findByPk(corpo.marcaId, { attributes: ['id'] }))) {
    throw erros.invalido('A marca informada não existe.');
  }

  conferirAnos({
    anoInicio: corpo.anoInicio ?? registro.ano_inicio,
    anoFim: corpo.anoFim ?? registro.ano_fim,
  });

  const antes = mapper.maquina(registro);
  const mudancas = somenteInformados(corpo, MAPA_EDICAO);
  if (corpo.marcaId !== undefined) mudancas.marca_id = corpo.marcaId;
  if (corpo.modelo !== undefined) mudancas.modelo_normalizado = normalizar(corpo.modelo);
  if (corpo.regerarSlug && corpo.modelo) {
    mudancas.slug = await slugUnico(db.Maquina, corpo.modelo, { ignorarId: registro.id });
  }

  await comConflitoTratado('uma máquina', () => registro.update(mudancas));

  await chavesCache.invalidarMaquinas();
  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: ENTIDADE.MAQUINA,
    entidadeId: registro.id,
    antes,
    depois: mapper.maquina(registro),
  });

  return mapper.maquina(registro);
}

/**
 * Remoção segura — máquina citada por anúncio é compatibilidade declarada
 * ("esta bomba serve no 6110J"). Apagar apagaria a informação que faz a busca
 * por máquina funcionar.
 */
async function remover(contexto, id) {
  const registro = await db.Maquina.findByPk(id);
  if (!registro) throw erros.naoEncontrado('Máquina');

  const anuncios = await db.AnuncioMaquina.count({ where: { maquina_id: registro.id } });
  if (anuncios) {
    throw erros.conflito(
      'Esta máquina está vinculada a anúncios e não pode ser removida. Desative-a para tirá-la dos formulários.',
      { anuncios, sugestao: 'ativo: false' }
    );
  }

  await registro.destroy();

  await chavesCache.invalidarMaquinas();
  await auditoria.registrar(contexto, {
    acao: 'remover',
    entidade: ENTIDADE.MAQUINA,
    entidadeId: registro.id,
    antes: mapper.maquina(registro),
  });

  return { removida: true, id: registro.id };
}

module.exports = { listar, porSlug, criar, editar, remover };
