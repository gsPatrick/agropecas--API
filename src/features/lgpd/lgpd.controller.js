'use strict';

const solicitacaoService = require('./lgpd.solicitacao.service');
const exportacaoService = require('./lgpd.exportacao.service');
const anonimizacaoService = require('./lgpd.anonimizacao.service');
const documentoService = require('./lgpd.documento.service');
const consentimentoService = require('./lgpd.consentimento.service');
const linkService = require('./lgpd.link.service');
const mapper = require('./lgpd.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

/**
 * Camada HTTP e só ela. Toda decisão de quem-pode-o-quê está nos services,
 * onde o dono do registro é conhecido — o middleware `autorizar` cobre só a
 * capacidade.
 */

// ─── solicitações do titular ────────────────────────────────────

const abrir = catchAsync(async (req, res) => {
  const solicitacao = await solicitacaoService.abrir(req.body, req.contexto);
  resposta.criado(res, mapper.solicitacao(solicitacao, { detalhe: true }), {
    mensagem: `Recebemos seu pedido. Responderemos em até ${solicitacaoService.PRAZO_RESPOSTA_DIAS} dias.`,
  });
});

const minhas = catchAsync(async (req, res) => {
  const { itens, ...meta } = await solicitacaoService.minhas(req.contexto, req.query);
  resposta.paginado(res, itens.map((item) => mapper.solicitacao(item)), meta);
});

const listar = catchAsync(async (req, res) => {
  const { itens, ...meta } = await solicitacaoService.listar(req.contexto, req.query);
  resposta.paginado(res, itens.map((item) => mapper.solicitacao(item, { detalhe: true })), meta);
});

const resumo = catchAsync(async (req, res) => {
  resposta.ok(res, await solicitacaoService.resumo(req.contexto));
});

const obter = catchAsync(async (req, res) => {
  const registro = await solicitacaoService.obter(req.params.id, req.contexto);
  resposta.ok(res, mapper.solicitacao(registro, { detalhe: true }));
});

const responder = catchAsync(async (req, res) => {
  const registro = await solicitacaoService.responder(req.params.id, req.body, req.contexto);
  resposta.ok(res, mapper.solicitacao(registro, { detalhe: true }));
});

// ─── exportação de dados ────────────────────────────────────────

const solicitarExportacao = catchAsync(async (req, res) => {
  const dados = await exportacaoService.solicitar(req.contexto, req.body);
  resposta.ok(res, dados, {
    mensagem: 'Enviamos um código para o seu e-mail. Confirme para liberar a exportação.',
  });
});

const confirmarExportacao = catchAsync(async (req, res) => {
  const dados = await exportacaoService.confirmar(req.contexto, req.body);
  /* 202: o pacote não existe ainda — prometer 200 com o arquivo obrigaria a
     montá-lo aqui, que é exatamente o que a fila evita */
  resposta.aceito(res, dados);
});

const exportarParaTitular = catchAsync(async (req, res) => {
  resposta.aceito(res, await exportacaoService.solicitarParaTitular(req.contexto, req.body));
});

const baixar = catchAsync(async (req, res) => {
  const { conteudo, nomeArquivo, mime } = await linkService.resgatar(req.params.token, req.contexto);

  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  /* o pacote não pode encostar em cache de proxy nem de navegador */
  res.setHeader('Cache-Control', 'no-store, private');
  res.send(conteudo);
});

// ─── anonimização ───────────────────────────────────────────────

const anonimizar = catchAsync(async (req, res) => {
  resposta.aceito(res, await anonimizacaoService.solicitar(req.body, req.contexto));
});

// ─── documentos legais ──────────────────────────────────────────

const documentoVigente = catchAsync(async (req, res) => {
  resposta.ok(res, mapper.documentoCompleto(await documentoService.obter(req.params.tipo)));
});

const documentosVigentes = catchAsync(async (req, res) => {
  const porTipo = await documentoService.vigentes();
  resposta.ok(res, Object.values(porTipo).map(mapper.documento));
});

const historicoDocumentos = catchAsync(async (req, res) => {
  const itens = await documentoService.historico(req.query.tipo);
  resposta.ok(res, itens.map(mapper.documento));
});

const publicarDocumento = catchAsync(async (req, res) => {
  const documento = await documentoService.publicar(req.body, req.contexto);
  resposta.criado(res, mapper.documento(documento), {
    mensagem: documento.exige_novo_aceite
      ? 'Versão publicada. Os usuários serão convidados a reaceitar.'
      : 'Versão publicada.',
  });
});

// ─── consentimentos ─────────────────────────────────────────────

const meusConsentimentos = catchAsync(async (req, res) => {
  const dados = await consentimentoService.meus(req.contexto.usuarioId);
  resposta.ok(res, {
    atuais: dados.atuais.map(mapper.consentimentoAtual),
    historico: dados.historico.map(mapper.consentimento),
    pendentes: dados.pendentes,
    precisaReaceitar: dados.precisaReaceitar,
  });
});

/** o front chama isto no boot para decidir se abre o modal de reaceite */
const pendencias = catchAsync(async (req, res) => {
  resposta.ok(res, await documentoService.pendenciasDeAceite(req.contexto.usuarioId));
});

const panoramaConsentimentos = catchAsync(async (req, res) => {
  resposta.ok(res, await consentimentoService.totalDesatualizados());
});

module.exports = {
  abrir,
  minhas,
  listar,
  resumo,
  obter,
  responder,
  solicitarExportacao,
  confirmarExportacao,
  exportarParaTitular,
  baixar,
  anonimizar,
  documentoVigente,
  documentosVigentes,
  historicoDocumentos,
  publicarDocumento,
  meusConsentimentos,
  pendencias,
  panoramaConsentimentos,
};
