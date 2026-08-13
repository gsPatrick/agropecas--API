'use strict';

const registroService = require('./contato.registro.service');
const revelacaoService = require('./contato.revelacao.service');
const consultaService = require('./contato.consulta.service');
const metricaService = require('./contato.metrica.service');
const mapper = require('./contato.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

/**
 * Controller — só HTTP.
 *
 * Nenhuma das regras deste módulo mora aqui: consentimento, janela de
 * contagem, cota de revelação e log de LGPD são todos dos services. É o que
 * garante que a mesma proteção valha quando um job ou outra feature chamar
 * `revelacaoService.revelar` sem passar por rota nenhuma.
 */

/**
 * Sempre 201, inclusive quando a janela já tinha contado.
 *
 * Repetir o clique não é erro do usuário — ele já abriu o WhatsApp e a
 * resposta da API não muda nada na tela dele. O campo `registrado` conta a
 * verdade para quem estiver medindo.
 */
const registrar = catchAsync(async (req, res) => {
  const resultado = await registroService.registrar(req.contexto, {
    anuncioId: req.params.anuncioId,
    ...req.body,
  });

  resposta.criado(res, mapper.registro(resultado));
});

const revelar = catchAsync(async (req, res) => {
  const dados = await revelacaoService.revelar(req.contexto, {
    anuncioId: req.params.anuncioId,
    origem: req.body?.origem,
  });

  resposta.ok(res, mapper.revelacao(dados), {
    mensagem: dados.whatsapp
      ? undefined
      : 'Este anunciante prefere ser contatado pelo chat da plataforma.',
  });
});

const recebidos = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await consultaService.listarRecebidos(
    req.contexto,
    req.params.anuncioId,
    req.query
  );

  resposta.paginado(res, mapper.lista(itens), { pagina, porPagina, total });
});

const meus = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await consultaService.listarMeus(
    req.contexto,
    req.query
  );

  resposta.paginado(res, mapper.lista(itens), { pagina, porPagina, total });
});

const metricas = catchAsync(async (req, res) => {
  resposta.ok(res, await metricaService.porAnuncio(req.contexto, req.params.anuncioId, req.query));
});

module.exports = { registrar, revelar, recebidos, meus, metricas };
