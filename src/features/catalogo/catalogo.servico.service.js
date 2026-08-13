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
 * Serviços — o que um prestador declara que faz.
 *
 * ⚠️ ESTE É O ASSUNTO MAIS SENSÍVEL DO MÓDULO.
 *
 * A cliente nunca entregou uma lista de serviços: o documento dela diz apenas
 * "informar quais serviços presta", e a lista que hoje aparece no front está
 * marcada como PROVISÓRIA. Enquanto ela não decidir, a lista real vai mudar —
 * possivelmente várias vezes, possivelmente no dia da apresentação.
 *
 * Por isso serviço é TABELA gerenciada pelo Admin e não enum em código: cada
 * ajuste da cliente precisa ser uma linha no banco, nunca um deploy. É também
 * por isso que a tabela nasce VAZIA no seed — semear a lista provisória daria
 * a ela aparência de decisão tomada.
 */

const COLUNAS = [
  'id',
  'categoria_id',
  'nome',
  'slug',
  'descricao',
  'icone',
  'ordem',
  'ativo',
  'total_prestadores',
];

async function listar({ busca, categoriaId, incluirInativos = false } = {}, { limit, offset }) {
  const assinatura = cache.assinatura({ busca, categoriaId, inativos: incluirInativos, limit, offset });

  return cache.lembrar(
    chavesCache.chaves.servicos(assinatura),
    async () => {
      const where = {};
      if (!incluirInativos) where.ativo = true;
      if (categoriaId) where.categoria_id = categoriaId;

      const porNome = filtroBusca('nome_normalizado', busca);
      if (porNome) Object.assign(where, porNome);

      const { rows, count } = await db.Servico.findAndCountAll({
        where,
        attributes: COLUNAS,
        include: [
          { model: db.Categoria, as: 'categoria', attributes: ['id', 'nome', 'slug'], required: false },
        ],
        order: [
          ['ordem', 'ASC'],
          ['nome', 'ASC'],
        ],
        limit,
        offset,
        raw: true,
        subQuery: false,
      });

      return { itens: rows.map(mapper.servico), total: count };
    },
    { ttl: TTL_CATALOGO }
  );
}

async function porSlug(slug) {
  const registro = await db.Servico.findOne({
    where: { slug },
    attributes: COLUNAS,
    include: [{ model: db.Categoria, as: 'categoria', attributes: ['id', 'nome', 'slug'] }],
    raw: true,
  });
  if (!registro) throw erros.naoEncontrado('Serviço');
  return mapper.servico(registro);
}

/**
 * A categoria precisa existir e aceitar serviço.
 *
 * Pendurar "Manutenção Hidráulica" numa categoria `peca` faria o serviço
 * aparecer no filtro de peças da busca — visível, errado e difícil de rastrear
 * até a linha do banco que causou.
 */
async function conferirCategoria(categoriaId) {
  if (!categoriaId) return null;
  const categoria = await db.Categoria.findByPk(categoriaId, { attributes: ['id', 'nome', 'slug', 'tipo'] });
  if (!categoria) throw erros.invalido('A categoria informada não existe.');
  if (categoria.tipo === 'peca') {
    throw erros.invalido('Esta categoria é de peças e não pode agrupar serviços.');
  }
  return categoria;
}

async function criar(contexto, corpo) {
  const categoria = await conferirCategoria(corpo.categoriaId);
  const slug = await slugUnico(db.Servico, corpo.slug || corpo.nome);

  const registro = await comConflitoTratado('um serviço', () =>
    db.Servico.create({
      categoria_id: corpo.categoriaId || null,
      nome: corpo.nome,
      nome_normalizado: normalizar(corpo.nome),
      slug,
      descricao: corpo.descricao || null,
      icone: corpo.icone || null,
      ordem: corpo.ordem ?? 0,
      ativo: corpo.ativo ?? true,
    })
  );

  await chavesCache.invalidarServicos();
  await auditoria.registrar(contexto, {
    acao: 'criar',
    entidade: ENTIDADE.SERVICO,
    entidadeId: registro.id,
    depois: mapper.servico(registro),
  });

  /* a instância recém-criada não carrega a associação; devolver a categoria
     junto evita o front pedir a lista inteira só para desenhar um rótulo */
  return mapper.servico({ ...registro.get(), categoria: categoria ? categoria.get() : null });
}

const MAPA_EDICAO = {
  nome: 'nome',
  descricao: 'descricao',
  icone: 'icone',
  ordem: 'ordem',
  ativo: 'ativo',
};

async function editar(contexto, id, corpo) {
  const registro = await db.Servico.findByPk(id);
  if (!registro) throw erros.naoEncontrado('Serviço');

  if (corpo.categoriaId !== undefined) await conferirCategoria(corpo.categoriaId);

  const antes = mapper.servico(registro);
  const mudancas = somenteInformados(corpo, MAPA_EDICAO);
  if (corpo.categoriaId !== undefined) mudancas.categoria_id = corpo.categoriaId || null;
  if (corpo.nome !== undefined) mudancas.nome_normalizado = normalizar(corpo.nome);
  if (corpo.regerarSlug && corpo.nome) {
    mudancas.slug = await slugUnico(db.Servico, corpo.nome, { ignorarId: registro.id });
  }

  await comConflitoTratado('um serviço', () => registro.update(mudancas));

  await chavesCache.invalidarServicos();
  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: ENTIDADE.SERVICO,
    entidadeId: registro.id,
    antes,
    depois: mapper.servico(registro),
  });

  return mapper.servico(registro);
}

/**
 * Remoção segura.
 *
 * Serviço já escolhido por prestador não some: apagar tiraria da vitrine dele
 * algo que ele declarou prestar, sem aviso e sem como recuperar qual era. Como
 * a lista é provisória e vai ser mexida, este é o caso MAIS provável de
 * acontecer neste módulo — daí o 409 sugerir explicitamente desativar.
 */
async function remover(contexto, id) {
  const registro = await db.Servico.findByPk(id);
  if (!registro) throw erros.naoEncontrado('Serviço');

  const prestadores = await db.PerfilServico.count({ where: { servico_id: registro.id } });
  if (prestadores) {
    throw erros.conflito(
      'Há prestadores que declaram este serviço. Desative-o em vez de remover, para não apagar o que eles informaram.',
      { prestadores, sugestao: 'ativo: false' }
    );
  }

  await registro.destroy();

  await chavesCache.invalidarServicos();
  await auditoria.registrar(contexto, {
    acao: 'remover',
    entidade: ENTIDADE.SERVICO,
    entidadeId: registro.id,
    antes: mapper.servico(registro),
  });

  return { removido: true, id: registro.id };
}

/** reordenação em lote — mesma tela drag-and-drop das categorias */
async function ordenar(contexto, itens) {
  const ids = itens.map((item) => item.id);
  const existentes = await db.Servico.count({ where: { id: ids } });
  if (existentes !== ids.length) throw erros.invalido('Algum serviço da lista não existe.');

  await db.sequelize.transaction(async (transaction) =>
    Promise.all(
      itens.map((item) =>
        db.Servico.update({ ordem: item.ordem }, { where: { id: item.id }, transaction })
      )
    )
  );

  await chavesCache.invalidarServicos();
  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: ENTIDADE.SERVICO,
    depois: { reordenados: ids.length },
    motivo: 'reordenacao',
  });

  return { reordenados: ids.length };
}

module.exports = { listar, porSlug, criar, editar, remover, ordenar };
