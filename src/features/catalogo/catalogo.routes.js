'use strict';

const { Router } = require('express');
const controller = require('./catalogo.controller');
const esquemas = require('./catalogo.validators');
const {
  autenticar,
  autenticacaoOpcional,
  autorizar,
  validar,
  rateLimit,
} = require('../../middlewares');

/**
 * Rotas do catálogo — o mapa da feature.
 *
 * Duas metades bem separadas:
 *
 *   LEITURA  pública. O catálogo alimenta os selects do formulário de anúncio e
 *            os filtros da busca; exigir login aqui esconderia o produto de
 *            quem ainda está decidindo se cria conta.
 *   ESCRITA  só Admin, via RBAC. É o que a cliente pediu em Maturacao/05 §2.4.
 *
 * `autenticacaoOpcional` nas leituras não é enfeite: é como o Admin logado vê
 * os itens inativos na mesma rota que o visitante usa, sem uma segunda API
 * paralela para manter em dia.
 *
 * Ordem dos middlewares: limite → validação → autorização → controller.
 */

const router = Router();

// ─── leitura pública ────────────────────────────────────────────
router.get(
  '/categorias',
  rateLimit.leitura(),
  validar.query(esquemas.listarCategorias),
  autenticacaoOpcional,
  controller.listarCategorias
);

router.get(
  '/marcas',
  rateLimit.leitura(),
  validar.query(esquemas.listarMarcas),
  autenticacaoOpcional,
  controller.listarMarcas
);

router.get(
  '/maquinas',
  rateLimit.leitura(),
  validar.query(esquemas.listarMaquinas),
  autenticacaoOpcional,
  controller.listarMaquinas
);

router.get(
  '/servicos',
  rateLimit.leitura(),
  validar.query(esquemas.listarServicos),
  autenticacaoOpcional,
  controller.listarServicos
);

/* sem filtro, sem paginação: 11 linhas, e "Minha propriedade" precisa da
   lista inteira para o multi-select — ver `catalogo.cultura.service.js` */
router.get('/culturas', rateLimit.leitura(), controller.listarCulturas);

/* o detalhe vem por SLUG e não por id: é o que a URL pública carrega
   (/categorias/bombas-hidraulicas), e é o que o SEO precisa */
router.get('/categorias/:slug', rateLimit.leitura(), validar.params(esquemas.identificadorSlug), controller.obterCategoria);
router.get('/marcas/:slug', rateLimit.leitura(), validar.params(esquemas.identificadorSlug), controller.obterMarca);
router.get('/maquinas/:slug', rateLimit.leitura(), validar.params(esquemas.identificadorSlug), controller.obterMaquina);
router.get('/servicos/:slug', rateLimit.leitura(), validar.params(esquemas.identificadorSlug), controller.obterServico);

// ─── escrita (Admin) ────────────────────────────────────────────
router.use(autenticar);
router.use(rateLimit.escrita());

/* a reordenação vem ANTES de `/:id`: declarada depois, o Express casaria
   "ordenar" como um id e o PATCH morreria em 422 de uuid inválido */
router.patch(
  '/categorias/ordenar',
  autorizar('categoria.ordenar'),
  validar(esquemas.ordenarCategorias),
  controller.ordenarCategorias
);

router.post('/categorias', autorizar('categoria.criar'), validar(esquemas.criarCategoria), controller.criarCategoria);
router.patch(
  '/categorias/:id',
  autorizar('categoria.editar'),
  validar.params(esquemas.identificador),
  validar(esquemas.editarCategoria),
  controller.editarCategoria
);
router.delete(
  '/categorias/:id',
  autorizar('categoria.remover'),
  validar.params(esquemas.identificador),
  controller.removerCategoria
);

router.post('/marcas', autorizar('marca.criar'), validar(esquemas.criarMarca), controller.criarMarca);
router.patch(
  '/marcas/:id',
  autorizar('marca.editar'),
  validar.params(esquemas.identificador),
  validar(esquemas.editarMarca),
  controller.editarMarca
);
router.delete(
  '/marcas/:id',
  autorizar('marca.remover'),
  validar.params(esquemas.identificador),
  controller.removerMarca
);

router.post('/maquinas', autorizar('maquina.criar'), validar(esquemas.criarMaquina), controller.criarMaquina);
router.patch(
  '/maquinas/:id',
  autorizar('maquina.editar'),
  validar.params(esquemas.identificador),
  validar(esquemas.editarMaquina),
  controller.editarMaquina
);
router.delete(
  '/maquinas/:id',
  autorizar('maquina.remover'),
  validar.params(esquemas.identificador),
  controller.removerMaquina
);

/* serviço não tem ação `ordenar` própria em `rbac/recursos.js` — só categoria
   tem. Enquanto ela não existir, reordenar serviço exige `servico.editar`, que
   é a permissão de quem gerencia a lista de qualquer forma. Reportado ao
   orquestrador */
router.patch(
  '/servicos/ordenar',
  autorizar('servico.editar'),
  validar(esquemas.ordenarServicos),
  controller.ordenarServicos
);

router.post('/servicos', autorizar('servico.criar'), validar(esquemas.criarServico), controller.criarServico);
router.patch(
  '/servicos/:id',
  autorizar('servico.editar'),
  validar.params(esquemas.identificador),
  validar(esquemas.editarServico),
  controller.editarServico
);
router.delete(
  '/servicos/:id',
  autorizar('servico.remover'),
  validar.params(esquemas.identificador),
  controller.removerServico
);

module.exports = router;
