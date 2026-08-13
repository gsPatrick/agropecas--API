'use strict';

const uploadService = require('./midia.upload.service');
const consultaService = require('./midia.consulta.service');
const remocaoService = require('./midia.remocao.service');
const { variantesDe } = require('./midia.processamento.service');
const mapper = require('./midia.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

/**
 * Controller — HTTP e só. Nenhuma decisão sobre tipo de arquivo, limite ou
 * escopo mora aqui: tudo isso é do service, que precisa valer igual quando a
 * mesma operação vier de um job ou de um script de importação.
 */

const enviar = catchAsync(async (req, res) => {
  const criados = await uploadService.enviar(
    {
      arquivos: req.arquivosRecebidos,
      referenciaTipo: req.body.referenciaTipo,
      referenciaId: req.body.referenciaId,
    },
    req.contexto
  );

  /* o processamento ainda não aconteceu; um upload reaproveitado (mesmo hash)
     pode já ter variantes, e por isso o mapa é consultado em vez de assumido */
  const mapa = await variantesDe(criados.map((arquivo) => arquivo.id));

  resposta.criado(
    res,
    criados.map((arquivo) => mapper.arquivo(arquivo, mapa.get(String(arquivo.id)) || {})),
    { mensagem: 'Imagens recebidas. As versões otimizadas ficam prontas em instantes.' }
  );
});

const listar = catchAsync(async (req, res) => {
  const { itens, paginacao } = await consultaService.listar(req.contexto, req.query);
  resposta.paginado(res, mapper.lista(itens), paginacao);
});

const obter = catchAsync(async (req, res) => {
  const { arquivo, variantes } = await consultaService.obter(req.contexto, req.params.id);
  resposta.ok(res, mapper.arquivo(arquivo, variantes));
});

const remover = catchAsync(async (req, res) => {
  await remocaoService.remover(req.contexto, req.params.id);
  resposta.semConteudo(res);
});

module.exports = { enviar, listar, obter, remover };
