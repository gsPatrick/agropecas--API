'use strict';

const db = require('../../models');
const auditoria = require('../auditoria/auditoria.service');
const { erros } = require('../../utils/erros');
const { normalizar } = require('../../utils/texto');
const mapper = require('./catalogo.mapper');
const chavesCache = require('./catalogo.cache');
const { ENTIDADE } = require('./catalogo.constants');
const { slugUnico, comConflitoTratado, somenteInformados } = require('./catalogo.comum');

/**
 * ESCRITA de categorias: criar, editar, remover e reordenar.
 *
 * Categoria é tabela e não enum por decisão da cliente (Maturacao/05, §2.4):
 * categoria nova não pode exigir deploy. A leitura, que é o caminho quente e
 * cacheado, vive em `catalogo.arvore.service.js`.
 */

/** o pai precisa existir e não pode ser a própria categoria nem uma descendente */
async function conferirPai(parentId, { proprioId } = {}) {
  if (!parentId) return null;
  if (proprioId && String(parentId) === String(proprioId)) {
    throw erros.invalido('Uma categoria não pode ser pai dela mesma.');
  }

  const pai = await db.Categoria.findByPk(parentId, { attributes: ['id', 'parent_id'] });
  if (!pai) throw erros.invalido('A categoria pai informada não existe.');

  if (proprioId) {
    /* subir a cadeia é barato (a árvore tem 2–3 níveis) e evita o ciclo que
       deixaria `montarArvore` com um galho órfão invisível na tela */
    let atual = pai;
    while (atual?.parent_id) {
      if (String(atual.parent_id) === String(proprioId)) {
        throw erros.invalido('Não dá para mover uma categoria para dentro de uma filha dela.');
      }
      atual = await db.Categoria.findByPk(atual.parent_id, { attributes: ['id', 'parent_id'] });
    }
  }

  return pai;
}

async function criar(contexto, corpo) {
  await conferirPai(corpo.parentId);
  const slug = await slugUnico(db.Categoria, corpo.slug || corpo.nome);

  const registro = await comConflitoTratado('uma categoria', () =>
    db.Categoria.create({
      parent_id: corpo.parentId || null,
      nome: corpo.nome,
      nome_normalizado: normalizar(corpo.nome),
      slug,
      descricao: corpo.descricao || null,
      tipo: corpo.tipo || 'peca',
      icone: corpo.icone || null,
      imagem_url: corpo.imagemUrl || null,
      ordem: corpo.ordem ?? 0,
      destaque: corpo.destaque ?? false,
      ativo: corpo.ativo ?? true,
      seo_titulo: corpo.seoTitulo || null,
      seo_descricao: corpo.seoDescricao || null,
    })
  );

  await chavesCache.invalidarCategorias();
  await auditoria.registrar(contexto, {
    acao: 'criar',
    entidade: ENTIDADE.CATEGORIA,
    entidadeId: registro.id,
    depois: mapper.categoria(registro),
  });

  return mapper.categoria(registro);
}

const MAPA_EDICAO = {
  nome: 'nome',
  descricao: 'descricao',
  tipo: 'tipo',
  icone: 'icone',
  imagemUrl: 'imagem_url',
  ordem: 'ordem',
  destaque: 'destaque',
  ativo: 'ativo',
  seoTitulo: 'seo_titulo',
  seoDescricao: 'seo_descricao',
};

async function editar(contexto, id, corpo) {
  const registro = await db.Categoria.findByPk(id);
  if (!registro) throw erros.naoEncontrado('Categoria');

  if (corpo.parentId !== undefined) {
    await conferirPai(corpo.parentId, { proprioId: registro.id });
  }

  const antes = mapper.categoria(registro);
  const mudancas = somenteInformados(corpo, MAPA_EDICAO);
  if (corpo.parentId !== undefined) mudancas.parent_id = corpo.parentId || null;

  /* o slug NÃO acompanha o nome numa correção de digitação: ele já está em
     link compartilhado e indexado pelo Google. Trocar exige pedir explicitamente */
  if (corpo.nome !== undefined) mudancas.nome_normalizado = normalizar(corpo.nome);
  if (corpo.regerarSlug && corpo.nome) {
    mudancas.slug = await slugUnico(db.Categoria, corpo.nome, { ignorarId: registro.id });
  }

  await comConflitoTratado('uma categoria', () => registro.update(mudancas));

  await chavesCache.invalidarCategorias();
  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: ENTIDADE.CATEGORIA,
    entidadeId: registro.id,
    antes,
    depois: mapper.categoria(registro),
  });

  return mapper.categoria(registro);
}

/**
 * Remoção segura.
 *
 * Categoria com anúncio vinculado não some: a FK é `ON DELETE SET NULL`, então
 * o banco deixaria passar e os anúncios ficariam sem categoria — invisíveis em
 * todo filtro da busca, sem nenhum erro que alguém percebesse. O 409 é o que
 * força o Admin a decidir para onde os anúncios vão antes.
 */
async function remover(contexto, id) {
  const registro = await db.Categoria.findByPk(id);
  if (!registro) throw erros.naoEncontrado('Categoria');

  const [anuncios, filhas, servicos] = await Promise.all([
    db.Anuncio.count({ where: { categoria_id: registro.id } }),
    db.Categoria.count({ where: { parent_id: registro.id } }),
    db.Servico.count({ where: { categoria_id: registro.id } }),
  ]);

  if (anuncios || filhas || servicos) {
    throw erros.conflito(
      'Esta categoria ainda está em uso e não pode ser removida. Mova o que está vinculado ou desative a categoria.',
      { anuncios, subcategorias: filhas, servicos, sugestao: 'ativo: false' }
    );
  }

  await registro.destroy();

  await chavesCache.invalidarCategorias();
  await auditoria.registrar(contexto, {
    acao: 'remover',
    entidade: ENTIDADE.CATEGORIA,
    entidadeId: registro.id,
    antes: mapper.categoria(registro),
  });

  return { removida: true, id: registro.id };
}

/**
 * Reordenação em lote.
 *
 * Vem em lote porque a tela é drag-and-drop: arrastar um item muda a posição
 * de vários, e mandar uma requisição por item deixaria a ordem inconsistente
 * se a rede caísse no meio. Transação única, ou tudo ou nada.
 */
async function ordenar(contexto, itens) {
  const ids = itens.map((item) => item.id);
  const existentes = await db.Categoria.count({ where: { id: ids } });
  if (existentes !== ids.length) throw erros.invalido('Alguma categoria da lista não existe.');

  await db.sequelize.transaction(async (transaction) =>
    Promise.all(
      itens.map((item) =>
        db.Categoria.update(
          {
            ordem: item.ordem,
            ...(item.destaque === undefined ? {} : { destaque: item.destaque }),
          },
          { where: { id: item.id }, transaction }
        )
      )
    )
  );

  await chavesCache.invalidarCategorias();
  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: ENTIDADE.CATEGORIA,
    depois: { reordenadas: ids.length },
    motivo: 'reordenacao',
  });

  return { reordenadas: ids.length };
}

module.exports = { criar, editar, remover, ordenar, conferirPai };
