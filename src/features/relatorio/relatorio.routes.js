'use strict';

const { Router } = require('express');
const controller = require('./relatorio.controller');
const esquemas = require('./relatorio.validators');
const { autenticar, autorizar, validar, rateLimit } = require('../../middlewares');

/**
 * Mapa da feature de relatórios. Com UMA exceção, nada aqui é público:
 * relatório agregado é inteligência de mercado da plataforma.
 *
 * A exceção é `GET /publico`, que devolve quatro contagens globais para a
 * home. Ela está declarada ANTES do `router.use(autenticar)` — a ordem é a
 * regra, não um detalhe: qualquer rota escrita depois daquela linha nasce
 * autenticada, que é o padrão certo para esta feature.
 *
 * **Rate limit próprio, mais apertado que o de leitura comum.** Uma consulta
 * de painel agrega várias tabelas; 300 req/min (o perfil de leitura) seria
 * convite a derrubar o banco com um laço de três linhas. 20/min é folgado para
 * uma pessoa mexendo em filtro e proibitivo para um script.
 */

const router = Router();

const limiteDeRelatorio = rateLimit({
  max: 20,
  janelaMs: 60 * 1000,
  /* conta por USUÁRIO e não por IP: no interior de MT a região inteira sai
     pelo mesmo IP de operadora, e limitar por IP tiraria do ar o escritório
     que tem cinco pessoas olhando o painel */
  chave: (req) => req.contexto?.usuarioId || req.contexto?.ipHash || req.ip,
  mensagem: 'Muitas consultas de relatório. Aguarde um instante.',
});

const limiteDeExportacao = rateLimit({
  max: 5,
  janelaMs: 10 * 60 * 1000,
  chave: (req) => req.contexto?.usuarioId || req.contexto?.ipHash || req.ip,
  mensagem: 'Muitas exportações solicitadas. Aguarde alguns minutos.',
});

// ─── público (a home, sem login) ────────────────────────────────
/**
 * Números institucionais da home.
 *
 * Usa `rateLimit.leitura()` (o perfil por IP, 300/min) e não o
 * `limiteDeRelatorio` daqui de cima: aquele conta por USUÁRIO, e visitante não
 * tem usuário — todos os visitantes cairiam no mesmo balde e a home sairia do
 * ar sozinha. O custo real desta rota é o cache, não o limite: a resposta vive
 * 10 minutos e o banco quase nunca é tocado.
 *
 * Sem `validar.query`: a rota não aceita parâmetro nenhum (ver o controller).
 */
router.get('/publico', rateLimit.leitura(), controller.publico);

// ─── daqui para baixo, tudo exige sessão ────────────────────────
router.use(autenticar);

// ─── painéis ────────────────────────────────────────────────────
router.get(
  '/painel',
  limiteDeRelatorio,
  validar.query(esquemas.painel),
  autorizar('relatorio.ler'),
  controller.painel
);

/**
 * "Meu desempenho" exige `anuncio.ver_metricas`, não `relatorio.ler`.
 *
 * `relatorio.ler` só existe com escopo `todos` (é painel de plataforma), e o
 * anunciante não o tem — se esta rota o exigisse, ninguém veria os próprios
 * números. `anuncio.ver_metricas.proprio` é justamente a permissão que o papel
 * `usuario` já recebe. O escopo (próprio × terceiro) é conferido no service.
 */
router.get(
  '/desempenho',
  limiteDeRelatorio,
  validar.query(esquemas.desempenho),
  autorizar('anuncio.ver_metricas'),
  controller.desempenho
);

router.get(
  '/busca',
  limiteDeRelatorio,
  validar.query(esquemas.busca),
  autorizar('relatorio.busca'),
  controller.busca
);

// ─── exportação (sempre pela fila) ──────────────────────────────
router.post(
  '/exportar',
  limiteDeExportacao,
  validar(esquemas.exportar),
  autorizar('relatorio.exportar'),
  controller.exportar
);

router.get('/exportacoes', limiteDeRelatorio, autorizar('relatorio.exportar'), controller.listarExportacoes);

router.get(
  '/exportacoes/:id/baixar',
  limiteDeRelatorio,
  validar.params(esquemas.identificador),
  validar.query(esquemas.download),
  autorizar('relatorio.exportar'),
  controller.baixarExportacao
);

module.exports = router;
