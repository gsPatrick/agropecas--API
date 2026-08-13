'use strict';

const anunciosService = require('../services/admin.conteudo.anuncios.service');
const moderacaoService = require('../services/admin.conteudo.moderacao.service');
const midiaService = require('../services/admin.conteudo.midia.service');
const catchAsync = require('../../../utils/catch-async');
const resposta = require('../../../utils/resposta');

/**
 * Conteúdo do painel — anúncios, moderação e mídia.
 *
 * Só HTTP: lê `req`, chama o service, devolve. Nenhum `if` de regra e nenhuma
 * consulta moram aqui — é o que permite que a mesma operação seja chamada por
 * um job da fila ou por um script de importação sem passar pelo Express.
 *
 * `usuario_id` nunca é lido do corpo em escrita: quem age é `req.contexto`. A
 * única exceção é `criarEmNomeDe`, onde o alvo é explícito, declarado, e passa
 * por `paraTerceiro` — que exige `admin.agir_em_nome_de` e grava a
 * representação na auditoria.
 */

// ─── anúncios ───────────────────────────────────────────────────
const listar = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await anunciosService.listar(req.contexto, req.query);
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const ver = catchAsync(async (req, res) =>
  resposta.ok(res, await anunciosService.ver(req.contexto, req.params.id))
);

const editar = catchAsync(async (req, res) =>
  resposta.ok(res, await anunciosService.editar(req.contexto, req.params.id, req.body))
);

const remover = catchAsync(async (req, res) =>
  resposta.ok(res, await anunciosService.remover(req.contexto, req.params.id, { motivo: req.body.motivo }))
);

const criarEmNomeDe = catchAsync(async (req, res) =>
  resposta.criado(res, await anunciosService.criarEmNomeDe(req.contexto, req.body))
);

// ─── moderação ──────────────────────────────────────────────────
const fila = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await moderacaoService.fila(req.contexto, req.query);
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const aprovar = catchAsync(async (req, res) =>
  resposta.ok(res, await moderacaoService.aprovar(req.contexto, req.params.id, {
    observacao: req.body.observacao || req.body.motivo,
  }))
);

const reprovar = catchAsync(async (req, res) =>
  resposta.ok(res, await moderacaoService.reprovar(req.contexto, req.params.id, { motivo: req.body.motivo }))
);

const ocultar = catchAsync(async (req, res) =>
  resposta.ok(res, await moderacaoService.ocultar(req.contexto, req.params.id, { motivo: req.body.motivo }))
);

const destacar = catchAsync(async (req, res) =>
  resposta.ok(res, await moderacaoService.destacar(req.contexto, req.params.id, req.body))
);

const moderarEmLote = catchAsync(async (req, res) =>
  resposta.ok(res, await moderacaoService.moderarEmLote(req.contexto, req.body))
);

// ─── mídia ──────────────────────────────────────────────────────
const bloquearFoto = catchAsync(async (req, res) =>
  resposta.ok(res, await midiaService.bloquearFoto(req.contexto, req.params.id, { motivo: req.body.motivo }))
);

const listarMidia = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await midiaService.listar(req.contexto, req.query);
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const removerMidia = catchAsync(async (req, res) =>
  resposta.ok(res, await midiaService.remover(req.contexto, req.params.id, { motivo: req.body.motivo }))
);

module.exports = {
  listar,
  ver,
  editar,
  remover,
  fila,
  aprovar,
  reprovar,
  ocultar,
  destacar,
  criarEmNomeDe,
  moderarEmLote,
  bloquearFoto,
  listarMidia,
  removerMidia,
};
