'use strict';

const cepService = require('./localizacao.cep.service');
const geocodeService = require('./localizacao.geocode.service');
const territorioService = require('./localizacao.territorio.service');
const enderecoService = require('./localizacao.endereco.service');
const distanciaService = require('./localizacao.distancia.service');
const privacidade = require('./localizacao.privacidade.service');
const mapper = require('./localizacao.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');
const db = require('../../models');

/**
 * Controller — camada HTTP e só ela. Nenhum `if` de regra de negócio: a decisão
 * de quem vê o endereço exato mora em `localizacao.privacidade.service`, e
 * repeti-la aqui seria criar uma segunda fonte de verdade para LGPD.
 */

const consultarCep = catchAsync(async (req, res) => {
  const resultado = await cepService.consultar(req.params.cep);
  resposta.ok(res, mapper.consultaCep(resultado));
});

const reverso = catchAsync(async (req, res) => {
  const resultado = await geocodeService.reverter(req.query.latitude, req.query.longitude);
  resposta.ok(res, mapper.consultaCoordenada(resultado));
});

const listarEstados = catchAsync(async (req, res) => {
  const estados = await territorioService.listarEstados();
  resposta.ok(res, estados.map(mapper.estado));
});

const listarMunicipios = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await territorioService.listarMunicipios(req.query);
  resposta.paginado(res, itens.map(mapper.municipio), { pagina, porPagina, total });
});

const salvarEndereco = catchAsync(async (req, res) => {
  const { endereco, alvo } = await enderecoService.salvar(req.body, req.contexto);

  /* quem acabou de gravar é o dono (ou o Admin): a resposta devolve o endereço
     exato, senão a tela de edição perderia o que a pessoa digitou */
  resposta.criado(res, mapper.endereco(endereco, { exato: true }), {
    alvo: { tipo: alvo.tipo, id: alvo.id },
  });
});

const verEndereco = catchAsync(async (req, res) => {
  const { endereco, perfil } = await enderecoService.obterComDono(req.params.id);

  const exato = privacidade.podeVerExato(req.contexto, {
    donoId: perfil?.usuario_id,
    exibirEnderecoExato: perfil?.exibir_endereco_exato,
    acaoLer: 'perfil.ler',
  });

  /* leitura de endereço exato de TERCEIRO é acesso a dado pessoal: a LGPD pede
     rastro de quem abriu, não só de quem alterou */
  const terceiroIdentificado =
    req.contexto.usuarioId && perfil && String(perfil.usuario_id) !== String(req.contexto.usuarioId);

  /* visitante anônimo lendo endereço que o titular decidiu abrir não gera log:
     é dado que ele mesmo publicou, e a tabela é para rastrear QUEM abriu — sem
     ator identificado o registro não responde pergunta nenhuma */
  if (exato && terceiroIdentificado) {
    await db.LogAcessoDado.create({
      ator_id: req.contexto.usuarioId,
      titular_id: perfil.usuario_id,
      recurso: 'endereco_exato',
      recurso_id: endereco.id,
      ip_hash: req.contexto.ipHash,
      user_agent: req.contexto.userAgent,
    }).catch((erro) => console.error('[localizacao] log de acesso falhou:', erro.message));
  }

  resposta.ok(res, mapper.endereco(endereco, { exato }));
});

const calcularDistancia = catchAsync(async (req, res) => {
  const itens = await distanciaService.calcular(req.body, req.contexto);
  resposta.ok(res, itens.map(mapper.distancia));
});

module.exports = {
  consultarCep,
  reverso,
  listarEstados,
  listarMunicipios,
  salvarEndereco,
  verEndereco,
  calcularDistancia,
};
