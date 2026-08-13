'use strict';

const filtroService = require('./busca.filtro.service');
const consultaService = require('./busca.consulta.service');
const facetaService = require('./busca.faceta.service');
const sugestaoService = require('./busca.sugestao.service');
const termoService = require('./busca.termo.service');
const logService = require('./busca.log.service');
const { normalizarTermo } = require('./busca.comum');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');
const { POR_PAGINA_OPCOES } = require('./busca.constants');

/**
 * Controller — HTTP e só. Nenhum filtro é interpretado aqui, nenhuma query é
 * montada aqui: o que este arquivo faz é ler `req`, chamar service e devolver.
 *
 * O ponto de atenção do módulo está no `buscar`: o log de busca é disparado
 * DEPOIS de a resposta estar montada e sem `await` bloqueante no caminho
 * crítico — a pessoa não pode esperar por uma gravação que não muda a tela
 * dela. O `catch` vazio é deliberado e explicado lá embaixo.
 */

const buscar = catchAsync(async (req, res) => {
  const filtros = await filtroService.montar(req.query);
  const resultado = await consultaService.buscar(filtros);

  /* diagnóstico de cache vai no header, não no corpo: `resposta.paginado` tem
     contrato fixo e o front não deve começar a depender de campo extra */
  res.setHeader('X-Cache', resultado.doCache ? 'HIT' : 'MISS');

  resposta.paginado(res, resultado.itens, {
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    total: resultado.total,
  });

  /**
   * Log DEPOIS de responder.
   *
   * `res` já foi escrito acima; o que vem aqui não atrasa ninguém. E o erro é
   * engolido de propósito: se o Redis da fila estiver fora, a busca do usuário
   * NÃO pode falhar por causa do relatório de termos populares. O que se perde
   * é uma linha de estatística.
   */
  logService
    .registrar({
      filtros,
      total: resultado.total,
      contexto: req.contexto,
      origem: req.query.origem,
    })
    .catch((erro) => console.error('[busca] log não registrado:', erro.message));
});

/**
 * Contagem por filtro do MESMO recorte.
 *
 * Endpoint separado, e não um campo a mais na busca, porque a agregação tem
 * custo próprio e ciclo de vida próprio (cache de 60s por recorte, indiferente
 * à página). Assim quem pagina de 1 a 10 paga a agregação uma vez, e quem não
 * desenha a coluna de filtros não paga nunca.
 */
const facetas = catchAsync(async (req, res) => {
  const filtros = await filtroService.montar(req.query);
  const contagens = await facetaService.calcular(filtros);

  resposta.ok(res, contagens, {
    ordem: filtros.ordem,
    opcoesPorPagina: POR_PAGINA_OPCOES,
    proximidade: filtros.origemGeo
      ? { raioKm: filtros.origemGeo.raioKm, fonte: filtros.origemGeo.fonte }
      : null,
  });
});

const sugerir = catchAsync(async (req, res) => {
  const itens = await sugestaoService.sugerir({ q: req.query.q, limite: req.query.limite });
  resposta.ok(res, itens);
});

const populares = catchAsync(async (req, res) => {
  const itens = await termoService.populares({
    uf: req.query.uf,
    limite: req.query.limite,
    dias: req.query.dias,
  });
  resposta.ok(res, itens);
});

/**
 * Clique em um resultado.
 *
 * Responde 202 e não 200: o que interessa ao cliente é que o registro foi
 * aceito, não se a linha correspondente foi achada — e o front dispara isso
 * durante a navegação para o anúncio, sem esperar resposta.
 */
const registrarClique = catchAsync(async (req, res) => {
  await logService
    .registrarClique({
      anuncioId: req.body.anuncioId,
      termoNormalizado: req.body.termo ? normalizarTermo(req.body.termo) : null,
      contexto: req.contexto,
    })
    .catch((erro) => console.error('[busca] clique não registrado:', erro.message));

  resposta.aceito(res, { registrado: true });
});

module.exports = { buscar, facetas, sugerir, populares, registrarClique };
