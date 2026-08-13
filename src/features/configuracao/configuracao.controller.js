'use strict';

const leitura = require('./configuracao.leitura.service');
const escrita = require('./configuracao.escrita.service');
const historicoService = require('./configuracao.historico.service');
const mapper = require('./configuracao.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

/**
 * Controller — só HTTP. Nenhuma decisão sobre o que é público, o que é
 * tipado ou o que é auditado mora aqui: tudo isso é regra e vive nos services,
 * que precisam funcionar igual quando chamados de um job da fila.
 */

/** rota aberta: só o subconjunto da lista branca */
const publicas = catchAsync(async (req, res) => {
  resposta.ok(res, await leitura.publicas());
});

const listar = catchAsync(async (req, res) => {
  const itens = await leitura.listar({ grupo: req.query.grupo });
  resposta.ok(res, mapper.lista(itens), { grupos: Object.keys(mapper.porGrupo(itens)) });
});

const obter = catchAsync(async (req, res) => {
  /* passa pelo service de escrita só para reaproveitar o 404: a leitura devolve
     null e o controller não deveria decidir o código do erro */
  await escrita.exigirChave(req.params.chave);
  resposta.ok(res, mapper.item(await leitura.detalhe(req.params.chave)));
});

const definir = catchAsync(async (req, res) => {
  const atualizada = await escrita.definir(req.contexto, {
    chave: req.params.chave,
    valor: req.body.valor,
    motivo: req.body.motivo,
  });

  resposta.ok(res, mapper.item(atualizada), { mensagem: 'Configuração atualizada.' });
});

const definirVarias = catchAsync(async (req, res) => {
  const itens = await escrita.definirVarias(req.contexto, req.body.itens);
  resposta.ok(res, mapper.lista(itens), { mensagem: 'Configurações atualizadas.' });
});

const historico = catchAsync(async (req, res) => {
  const registro = await escrita.exigirChave(req.params.chave);
  const { itens, pagina, porPagina, total } = await historicoService.listar(registro.id, req.query);

  resposta.paginado(res, itens.map(mapper.historico), { pagina, porPagina, total });
});

module.exports = { publicas, listar, obter, definir, definirVarias, historico };
