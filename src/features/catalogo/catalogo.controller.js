'use strict';

const arvoreService = require('./catalogo.arvore.service');
const categoriaService = require('./catalogo.categoria.service');
const marcaService = require('./catalogo.marca.service');
const maquinaService = require('./catalogo.maquina.service');
const servicoService = require('./catalogo.servico.service');
const culturaService = require('./catalogo.cultura.service');
const { pode } = require('../../rbac');
const { lerPaginacao } = require('../../utils/paginacao');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

/**
 * Controller — só HTTP. Lê a query, chama o service, devolve.
 *
 * A única decisão que mora aqui é qual RECORTE o chamador enxerga, e ela é
 * HTTP de verdade: a mesma rota serve o visitante e o Admin, e é a requisição
 * que diz quem está pedindo. A regra em si continua no RBAC.
 */

/**
 * Item inativo é invisível para quem não gerencia.
 *
 * `?incluirInativas=true` vindo de um visitante seria uma forma trivial de
 * enxergar o rascunho de catálogo que o Admin ainda não publicou — e a
 * listagem é pública, então ninguém precisaria nem de conta para tentar.
 */
const verInativos = (req, acao) =>
  Boolean(
    (req.query.incluirInativas || req.query.incluirInativos) && pode(req.contexto, acao)
  );

const paginacao = (req) => lerPaginacao(req.query, { porPaginaPadrao: 50, maximo: 200 });

// ─── categorias ─────────────────────────────────────────────────
const listarCategorias = catchAsync(async (req, res) => {
  const incluirInativas = verInativos(req, 'categoria.editar');

  /* a árvore não é paginada de propósito: um menu com metade dos galhos não é
     um menu. O conjunto é pequeno (dezenas de nós), fechado e cacheado — e o
     front precisa dele inteiro para desenhar o select em cascata */
  /* `destaque` vale nos dois formatos: a home pede a árvore só com a curadoria
     e o Admin pede a lista plana para gerenciá-la. Na árvore, uma filha cuja
     mãe ficou fora do recorte sobe para a raiz — é o mesmo comportamento já
     documentado em `montarArvore` para o filtro de inativas, e é o desejado
     aqui: destaque é curadoria de vitrine, não hierarquia */
  if (req.query.arvore !== false) {
    const itens = await arvoreService.arvore({
      tipo: req.query.tipo,
      incluirInativas,
      destaque: req.query.destaque,
    });
    return resposta.ok(res, itens, { total: itens.length, formato: 'arvore' });
  }

  const { pagina, porPagina, limit, offset } = paginacao(req);
  const { itens, total } = await arvoreService.buscar(
    {
      busca: req.query.busca,
      tipo: req.query.tipo,
      incluirInativas,
      destaque: req.query.destaque,
    },
    { limit, offset }
  );

  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const obterCategoria = catchAsync(async (req, res) =>
  resposta.ok(res, await arvoreService.porSlug(req.params.slug))
);

const criarCategoria = catchAsync(async (req, res) =>
  resposta.criado(res, await categoriaService.criar(req.contexto, req.body))
);

const editarCategoria = catchAsync(async (req, res) =>
  resposta.ok(res, await categoriaService.editar(req.contexto, req.params.id, req.body))
);

const removerCategoria = catchAsync(async (req, res) =>
  resposta.ok(res, await categoriaService.remover(req.contexto, req.params.id))
);

const ordenarCategorias = catchAsync(async (req, res) =>
  resposta.ok(res, await categoriaService.ordenar(req.contexto, req.body.itens))
);

// ─── marcas ─────────────────────────────────────────────────────
const listarMarcas = catchAsync(async (req, res) => {
  const { pagina, porPagina, limit, offset } = paginacao(req);
  const { itens, total } = await marcaService.listar(
    {
      busca: req.query.busca,
      tipo: req.query.tipo,
      incluirInativas: verInativos(req, 'marca.editar'),
    },
    { limit, offset }
  );

  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const obterMarca = catchAsync(async (req, res) =>
  resposta.ok(res, await marcaService.porSlug(req.params.slug))
);

const criarMarca = catchAsync(async (req, res) =>
  resposta.criado(res, await marcaService.criar(req.contexto, req.body))
);

const editarMarca = catchAsync(async (req, res) =>
  resposta.ok(res, await marcaService.editar(req.contexto, req.params.id, req.body))
);

const removerMarca = catchAsync(async (req, res) =>
  resposta.ok(res, await marcaService.remover(req.contexto, req.params.id))
);

// ─── máquinas ───────────────────────────────────────────────────
const listarMaquinas = catchAsync(async (req, res) => {
  const { pagina, porPagina, limit, offset } = paginacao(req);
  const { itens, total } = await maquinaService.listar(
    {
      busca: req.query.busca,
      marcaId: req.query.marcaId,
      categoriaMaquina: req.query.categoriaMaquina,
      incluirInativas: verInativos(req, 'maquina.editar'),
    },
    { limit, offset }
  );

  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const obterMaquina = catchAsync(async (req, res) =>
  resposta.ok(res, await maquinaService.porSlug(req.params.slug))
);

const criarMaquina = catchAsync(async (req, res) =>
  resposta.criado(res, await maquinaService.criar(req.contexto, req.body))
);

const editarMaquina = catchAsync(async (req, res) =>
  resposta.ok(res, await maquinaService.editar(req.contexto, req.params.id, req.body))
);

const removerMaquina = catchAsync(async (req, res) =>
  resposta.ok(res, await maquinaService.remover(req.contexto, req.params.id))
);

// ─── serviços ───────────────────────────────────────────────────
const listarServicos = catchAsync(async (req, res) => {
  const { pagina, porPagina, limit, offset } = paginacao(req);
  const { itens, total } = await servicoService.listar(
    {
      busca: req.query.busca,
      categoriaId: req.query.categoriaId,
      incluirInativos: verInativos(req, 'servico.editar'),
    },
    { limit, offset }
  );

  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const obterServico = catchAsync(async (req, res) =>
  resposta.ok(res, await servicoService.porSlug(req.params.slug))
);

const criarServico = catchAsync(async (req, res) =>
  resposta.criado(res, await servicoService.criar(req.contexto, req.body))
);

const editarServico = catchAsync(async (req, res) =>
  resposta.ok(res, await servicoService.editar(req.contexto, req.params.id, req.body))
);

const removerServico = catchAsync(async (req, res) =>
  resposta.ok(res, await servicoService.remover(req.contexto, req.params.id))
);

const ordenarServicos = catchAsync(async (req, res) =>
  resposta.ok(res, await servicoService.ordenar(req.contexto, req.body.itens))
);

/* sem paginação: são 11 itens, sempre a lista inteira — a tela "Minha
   propriedade" precisa de todas para o multi-select, não de uma página */
const listarCulturas = catchAsync(async (req, res) =>
  resposta.ok(res, await culturaService.listar())
);

module.exports = {
  listarCategorias,
  obterCategoria,
  criarCategoria,
  editarCategoria,
  removerCategoria,
  ordenarCategorias,
  listarMarcas,
  obterMarca,
  criarMarca,
  editarMarca,
  removerMarca,
  listarMaquinas,
  obterMaquina,
  criarMaquina,
  editarMaquina,
  removerMaquina,
  listarServicos,
  obterServico,
  criarServico,
  editarServico,
  removerServico,
  ordenarServicos,
  listarCulturas,
};
