'use strict';

const consultaService = require('./notificacao.consulta.service');
const contadorService = require('./notificacao.contador.service');
const leituraService = require('./notificacao.leitura.service');
const preferenciaService = require('./notificacao.preferencia.service');
const templateService = require('./notificacao.template.service');
const massaService = require('./notificacao.massa.service');
const mapper = require('./notificacao.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

/**
 * Controller — camada HTTP e só ela. Lê a requisição, chama um service,
 * devolve. Nenhuma decisão de escopo aqui: quem sabe de quem é a notificação é
 * o service, depois de buscá-la.
 */

const listar = catchAsync(async (req, res) => {
  const { itens, total, pagina, porPagina } = await consultaService.listar(req.contexto, req.query);
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const contador = catchAsync(async (req, res) => {
  resposta.ok(res, await contadorService.atual(req.contexto.usuarioId));
});

const marcarUma = catchAsync(async (req, res) => {
  resposta.ok(res, await leituraService.marcarUma(req.contexto, req.params.id));
});

const marcarVarias = catchAsync(async (req, res) => {
  resposta.ok(res, await leituraService.marcarVarias(req.contexto, req.body.ids));
});

const marcarTodas = catchAsync(async (req, res) => {
  resposta.ok(res, await leituraService.marcarTodas(req.contexto, req.body));
});

const listarPreferencias = catchAsync(async (req, res) => {
  resposta.ok(res, await preferenciaService.listar(req.contexto.usuarioId));
});

const salvarPreferencias = catchAsync(async (req, res) => {
  /* o usuário só configura as PRÓPRIAS preferências: o id sai do contexto,
     nunca do corpo — aceitar `usuarioId` daria a qualquer um o poder de
     silenciar as notificações de outra pessoa */
  resposta.ok(res, await preferenciaService.definir(req.contexto.usuarioId, req.body.itens), {
    mensagem: 'Preferências salvas.',
  });
});

const listarTemplates = catchAsync(async (req, res) => {
  const itens = await templateService.listar();
  resposta.ok(res, itens.map(mapper.template));
});

const obterTemplate = catchAsync(async (req, res) => {
  resposta.ok(res, mapper.template(await templateService.obter(req.params.id)));
});

const criarTemplate = catchAsync(async (req, res) => {
  const { corpoHtml, ...resto } = req.body;
  const registro = await templateService.criar(req.contexto, { ...resto, corpo_html: corpoHtml });

  resposta.criado(res, mapper.template(registro));
});

const atualizarTemplate = catchAsync(async (req, res) => {
  const { corpoHtml, ...resto } = req.body;
  const registro = await templateService.atualizar(req.contexto, req.params.id, {
    ...resto,
    ...(corpoHtml === undefined ? {} : { corpo_html: corpoHtml }),
  });

  resposta.ok(res, mapper.template(registro));
});

const removerTemplate = catchAsync(async (req, res) => {
  await templateService.remover(req.contexto, req.params.id);
  resposta.semConteudo(res);
});

const enviarEmMassa = catchAsync(async (req, res) => {
  /* 202: o comunicado foi ACEITO, não entregue. Devolver 200 daria a entender
     que a base inteira já recebeu antes do primeiro bloco rodar */
  resposta.aceito(res, await massaService.agendar(req.contexto, req.body));
});

const listarEmMassa = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await massaService.listar(req.contexto, req.query);
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

module.exports = {
  listar,
  contador,
  marcarUma,
  marcarVarias,
  marcarTodas,
  listarPreferencias,
  salvarPreferencias,
  listarTemplates,
  obterTemplate,
  criarTemplate,
  atualizarTemplate,
  removerTemplate,
  enviarEmMassa,
  listarEmMassa,
};
