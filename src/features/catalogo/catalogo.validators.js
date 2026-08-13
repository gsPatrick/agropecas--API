'use strict';

const { campos, esquema } = require('../../validacao');
const { CATEGORIA_TIPO, MARCA_TIPO, MAQUINA_CATEGORIA } = require('./catalogo.constants');

/**
 * Esquemas de entrada do catálogo.
 *
 * Compilados uma vez, no carregamento do módulo. Nenhuma biblioteca de
 * validação aparece aqui — só o vocabulário de `src/validacao`.
 *
 * Detalhe que se repete em todo esquema de EDIÇÃO: nada é `obrigatorio()`. A
 * tela do Admin manda PATCH com o campo que mudou, e exigir o nome inteiro
 * para trocar só a ordem faria o front reenviar dado que ele nem carregou.
 */

const nome = (max) => campos.texto().min(2, 'O nome precisa de ao menos 2 caracteres.').max(max);
const icone = () => campos.texto().max(40);
const url = () => campos.texto().max(500);

/** o `ativo` é o desligamento suave — o Admin usa mais do que o DELETE */
const ativo = () => campos.booleano();
const ordem = () => campos.inteiro().min(0).max(100000);

/** paginação + recorte comum a todas as listagens */
const listagemBase = {
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(200),
  busca: campos.texto().max(80),
  /* quem não é Admin nunca vê inativo; o controller decide. O campo existe no
     esquema para não ser descartado antes do controller poder olhar */
  incluirInativas: campos.booleano(),
  incluirInativos: campos.booleano(),
};

// ─── categorias ─────────────────────────────────────────────────
const listarCategorias = esquema({
  ...listagemBase,
  tipo: campos.umDe(CATEGORIA_TIPO).rotulo('tipo de categoria'),
  /* `arvore=false` devolve lista plana paginada — é o que a tela do Admin usa */
  arvore: campos.booleano().padrao(true),

  /**
   * Só as destacadas (`true`) ou só as demais (`false`).
   *
   * Sem `padrao()` de propósito: o menu em cascata precisa do catálogo
   * inteiro, e um padrão `false` aqui esconderia metade dele em toda tela que
   * hoje não manda o campo. Quem quer a curadoria pede por ela.
   */
  destaque: campos.booleano(),
});

const criarCategoria = esquema({
  nome: nome(120).obrigatorio('Informe o nome da categoria.'),
  slug: campos.texto().max(140),
  parentId: campos.uuid().permitindoNulo(),
  descricao: campos.textoLongo().max(2000),
  tipo: campos.umDe(CATEGORIA_TIPO).padrao('peca').rotulo('tipo de categoria'),
  icone: icone(),
  imagemUrl: url(),
  ordem: ordem(),
  destaque: campos.booleano(),
  ativo: ativo(),
  seoTitulo: campos.texto().max(180),
  seoDescricao: campos.texto().max(300),
});

const editarCategoria = esquema({
  nome: nome(120),
  parentId: campos.uuid().permitindoNulo(),
  descricao: campos.textoLongo().max(2000),
  tipo: campos.umDe(CATEGORIA_TIPO).rotulo('tipo de categoria'),
  icone: icone(),
  imagemUrl: url(),
  ordem: ordem(),
  destaque: campos.booleano(),
  ativo: ativo(),
  seoTitulo: campos.texto().max(180),
  seoDescricao: campos.texto().max(300),
  /* trocar slug quebra link já compartilhado: só acontece se pedirem */
  regerarSlug: campos.booleano(),
});

const ordenarCategorias = esquema({
  itens: campos
    .lista(
      campos.objeto({
        id: campos.uuid().obrigatorio(),
        ordem: ordem().obrigatorio(),
        destaque: campos.booleano(),
      })
    )
    .obrigatorio('Informe a nova ordem.')
    .min(1)
    .max(500),
});

// ─── marcas ─────────────────────────────────────────────────────
const listarMarcas = esquema({
  ...listagemBase,
  tipo: campos.umDe(MARCA_TIPO).rotulo('tipo de marca'),
});

const criarMarca = esquema({
  nome: nome(100).obrigatorio('Informe o nome da marca.'),
  slug: campos.texto().max(120),
  logoUrl: url(),
  tipo: campos.umDe(MARCA_TIPO).padrao('ambos').rotulo('tipo de marca'),
  ordem: ordem(),
  ativo: ativo(),
});

const editarMarca = esquema({
  nome: nome(100),
  logoUrl: url(),
  tipo: campos.umDe(MARCA_TIPO).rotulo('tipo de marca'),
  ordem: ordem(),
  ativo: ativo(),
  regerarSlug: campos.booleano(),
});

// ─── máquinas ───────────────────────────────────────────────────
/* 1950 como piso: máquina anterior a isso não circula mais em MT, e o campo
   aberto convida a digitar "19" e criar lixo no filtro de ano */
const ano = () => campos.inteiro().min(1950).max(new Date().getFullYear() + 2);

const listarMaquinas = esquema({
  ...listagemBase,
  marcaId: campos.uuid(),
  categoriaMaquina: campos.umDe(MAQUINA_CATEGORIA).rotulo('categoria de máquina'),
});

const criarMaquina = esquema({
  marcaId: campos.uuid().obrigatorio('Escolha a marca.'),
  modelo: nome(120).obrigatorio('Informe o modelo.'),
  slug: campos.texto().max(160),
  categoriaMaquina: campos.umDe(MAQUINA_CATEGORIA).padrao('trator').rotulo('categoria de máquina'),
  anoInicio: ano(),
  anoFim: ano(),
  potenciaCv: campos.inteiro().min(0).max(3000),
  observacao: campos.textoLongo().max(2000),
  ativo: ativo(),
});

const editarMaquina = esquema({
  marcaId: campos.uuid(),
  modelo: nome(120),
  categoriaMaquina: campos.umDe(MAQUINA_CATEGORIA).rotulo('categoria de máquina'),
  anoInicio: ano(),
  anoFim: ano(),
  potenciaCv: campos.inteiro().min(0).max(3000),
  observacao: campos.textoLongo().max(2000),
  ativo: ativo(),
  regerarSlug: campos.booleano(),
});

// ─── serviços ───────────────────────────────────────────────────
const listarServicos = esquema({
  ...listagemBase,
  categoriaId: campos.uuid(),
});

const criarServico = esquema({
  nome: nome(120).obrigatorio('Informe o nome do serviço.'),
  slug: campos.texto().max(140),
  categoriaId: campos.uuid().permitindoNulo(),
  descricao: campos.textoLongo().max(2000),
  icone: icone(),
  ordem: ordem(),
  ativo: ativo(),
});

const editarServico = esquema({
  nome: nome(120),
  categoriaId: campos.uuid().permitindoNulo(),
  descricao: campos.textoLongo().max(2000),
  icone: icone(),
  ordem: ordem(),
  ativo: ativo(),
  regerarSlug: campos.booleano(),
});

const ordenarServicos = esquema({
  itens: campos
    .lista(campos.objeto({ id: campos.uuid().obrigatorio(), ordem: ordem().obrigatorio() }))
    .obrigatorio('Informe a nova ordem.')
    .min(1)
    .max(500),
});

// ─── params ─────────────────────────────────────────────────────
const identificador = esquema({ id: campos.uuid().obrigatorio('Identificador inválido.') });
const identificadorSlug = esquema({
  slug: campos.texto().obrigatorio('Identificador inválido.').max(180),
});

module.exports = {
  listarCategorias,
  criarCategoria,
  editarCategoria,
  ordenarCategorias,
  listarMarcas,
  criarMarca,
  editarMarca,
  listarMaquinas,
  criarMaquina,
  editarMaquina,
  listarServicos,
  criarServico,
  editarServico,
  ordenarServicos,
  identificador,
  identificadorSlug,
};
