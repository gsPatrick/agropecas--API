'use strict';

const { Router } = require('express');
const controller = require('./auditoria.controller');
const esquemas = require('./auditoria.validators');
const { autenticar, autorizar, validar, rateLimit } = require('../../middlewares');

/**
 * Mapa da trilha de auditoria.
 *
 * **Só há verbos de leitura e um POST que enfileira.** Não existe PATCH, PUT
 * nem DELETE em nenhuma rota deste arquivo, e isso é a garantia principal do
 * módulo: um log que o Admin pode editar não prova nada contra o Admin. Quem
 * for adicionar rota aqui e precisar de um verbo de escrita sobre uma linha
 * existente está resolvendo o problema errado.
 */

const router = Router();

/**
 * Guarda a query CRUA antes da validação.
 *
 * O validador descarta campo desconhecido em silêncio — ótimo contra mass
 * assignment, péssimo aqui: uma tentativa de filtrar a trilha por exclusão de
 * ator sumiria sem deixar rastro, e o cliente acharia que funcionou. Com a
 * cópia crua, o service consegue recusar com 422 explícito.
 */
/* o middleware é compartilhado: o painel administrativo expõe a mesma trilha e
   precisa exatamente da mesma proteção */
const guardarQueryBruta = require('../../middlewares/query-bruta');

router.use(autenticar);
router.use(rateLimit.leitura());

router.get(
  '/',
  guardarQueryBruta,
  validar.query(esquemas.filtros),
  autorizar('auditoria.ler'),
  controller.listar
);

router.get(
  '/acessos-a-dados',
  guardarQueryBruta,
  validar.query(esquemas.acessos),
  autorizar('auditoria.ler'),
  controller.acessos
);

/**
 * Limite da exportação — caro, por isso apertado.
 *
 * `chave` própria por dois motivos. O primeiro é correção: dois `rateLimit` na
 * mesma rota montam o MESMO identificador (método + caminho + IP) e passam a
 * dividir um contador só, então o limite estrito herdaria a contagem do limite
 * folgado do router e recusaria antes da hora. O segundo é produto: no interior
 * de MT a região inteira sai pelo IP da operadora, e contar por IP faria a
 * exportação de um usuário consumir a cota do vizinho.
 */
router.post(
  '/exportacoes',
  rateLimit({
    max: 5,
    janelaMs: 60 * 60 * 1000,
    chave: (req) => `export:${req.contexto?.usuarioId || req.ip}`,
  }),
  validar(esquemas.exportar),
  autorizar('auditoria.exportar'),
  controller.exportar
);

router.get(
  '/downloads/:token',
  rateLimit({ max: 20, janelaMs: 60 * 60 * 1000, chave: (req) => `download:${req.contexto?.usuarioId || req.ip}` }),
  validar.params(esquemas.tokenDownload),
  controller.baixar
);

/* trilha de uma entidade: "tudo que já aconteceu com este anúncio" */
router.get(
  '/entidades/:entidade/:entidadeId',
  validar.params(esquemas.daEntidade),
  validar.query(esquemas.paginacao),
  autorizar('auditoria.ler'),
  controller.daEntidade
);

/* por último: `:id` engoliria `/acessos-a-dados` se viesse antes */
router.get('/:id', validar.params(esquemas.identificador), autorizar('auditoria.ler'), controller.obter);

module.exports = router;
