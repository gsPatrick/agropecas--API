'use strict';

const catalogoService = require('../services/admin.catalogo.service');
const catchAsync = require('../../../utils/catch-async');
const resposta = require('../../../utils/resposta');

/**
 * Catálogo do painel — uma tela, quatro coleções (`:colecao`).
 *
 * Só HTTP. A decisão de QUAL permissão cada coleção exige mora no service, e
 * não aqui, porque ela é regra de autorização: precisa valer também quando a
 * mesma operação vier de um script de importação de catálogo, que não passa
 * pelo Express.
 */

const listar = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await catalogoService.listar(
    req.contexto,
    req.params.colecao,
    req.query
  );
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const criar = catchAsync(async (req, res) =>
  resposta.criado(res, await catalogoService.criar(req.contexto, req.params.colecao, req.body))
);

const editar = catchAsync(async (req, res) => {
  /**
   * `PATCH /catalogo/:colecao/ordenar` está declarado DEPOIS de
   * `PATCH /catalogo/:colecao/:id` no mapa de rotas, então o Express casa
   * "ordenar" como se fosse um id. O mapa é contrato fechado e não pode ser
   * reordenado aqui; este desvio evita que a tela de reordenação caia numa
   * edição com id inexistente. Reportado ao orquestrador.
   */
  if (req.params.id === 'ordenar') {
    return resposta.ok(
      res,
      await catalogoService.ordenar(req.contexto, req.params.colecao, req.body.itens)
    );
  }

  return resposta.ok(
    res,
    await catalogoService.editar(req.contexto, req.params.colecao, req.params.id, req.body)
  );
});

const remover = catchAsync(async (req, res) =>
  resposta.ok(res, await catalogoService.remover(req.contexto, req.params.colecao, req.params.id))
);

const ordenar = catchAsync(async (req, res) =>
  resposta.ok(res, await catalogoService.ordenar(req.contexto, req.params.colecao, req.body.itens))
);

module.exports = { listar, criar, editar, remover, ordenar };
