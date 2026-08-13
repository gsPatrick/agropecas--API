'use strict';

const consultaService = require('./usuario.consulta.service');
const perfilService = require('./usuario.perfil.service');
const emailService = require('./usuario.email.service');
const moderacaoService = require('./usuario.moderacao.service');
const papelService = require('./usuario.papel.service');
const exclusaoService = require('./usuario.exclusao.service');
const mapper = require('./usuario.mapper');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

/**
 * Controller — HTTP e só isso: lê a requisição, chama um service, devolve.
 *
 * Nenhuma decisão de permissão mora aqui. O que parece decisão — "é a minha
 * conta ou a de outro?" — é apenas a escolha de passar ou não `req.params.id`
 * adiante; quem julga é o RBAC dentro do service, onde o dono do registro é
 * conhecido.
 *
 * `usuario_id` nunca vem do corpo: sai de `req.contexto.usuarioId`.
 */

const eu = catchAsync(async (req, res) => {
  const usuario = await consultaService.meusDados(req.contexto);
  resposta.ok(res, mapper.usuario(usuario));
});

const atualizarEu = catchAsync(async (req, res) => {
  const usuario = await perfilService.atualizar(req.contexto, req.body);
  resposta.ok(res, mapper.usuario(usuario), { mensagem: 'Dados atualizados.' });
});

const listar = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await consultaService.listar(req.contexto, req.query);
  resposta.paginado(res, itens.map(mapper.item), { pagina, porPagina, total });
});

const ver = catchAsync(async (req, res) => {
  const usuario = await consultaService.ver(req.contexto, req.params.id);
  resposta.ok(res, mapper.ficha(usuario));
});

const atualizar = catchAsync(async (req, res) => {
  const usuario = await perfilService.atualizar(req.contexto, req.body, req.params.id);
  resposta.ok(res, mapper.usuario(usuario), { mensagem: 'Dados atualizados.' });
});

const solicitarTrocaEmail = catchAsync(async (req, res) => {
  const dados = await emailService.solicitarTroca(req.contexto, req.body);
  resposta.ok(res, dados, {
    mensagem: 'Enviamos um código para o novo e-mail. Ele só passa a valer depois da confirmação.',
  });
});

const confirmarTrocaEmail = catchAsync(async (req, res) => {
  const usuario = await emailService.confirmarTroca(req.contexto, req.body);
  resposta.ok(res, mapper.usuario(usuario), { mensagem: 'E-mail alterado.' });
});

const excluirEu = catchAsync(async (req, res) => {
  resposta.ok(res, await exclusaoService.excluir(req.contexto, req.body), {
    mensagem: 'Conta excluída. Seus dados pessoais foram anonimizados.',
  });
});

const excluir = catchAsync(async (req, res) => {
  resposta.ok(res, await exclusaoService.excluir(req.contexto, req.body, req.params.id));
});

const suspender = catchAsync(async (req, res) => {
  const { usuario, sessoesEncerradas } = await moderacaoService.suspender(
    req.contexto,
    req.params.id,
    req.body
  );
  resposta.ok(res, { usuario: mapper.ficha(usuario), sessoesEncerradas });
});

const banir = catchAsync(async (req, res) => {
  const { usuario, sessoesEncerradas } = await moderacaoService.banir(
    req.contexto,
    req.params.id,
    req.body
  );
  resposta.ok(res, { usuario: mapper.ficha(usuario), sessoesEncerradas });
});

const restaurar = catchAsync(async (req, res) => {
  const usuario = await moderacaoService.restaurar(req.contexto, req.params.id, req.body);
  resposta.ok(res, mapper.ficha(usuario));
});

const listarPapeis = catchAsync(async (req, res) => {
  const usuario = await consultaService.carregarAlvo(req.contexto, req.params.id);
  resposta.ok(res, (usuario.papeis || []).map(mapper.papel));
});

const atribuirPapel = catchAsync(async (req, res) => {
  const { criado } = await papelService.atribuir(req.contexto, req.params.id, req.body);
  const papeis = await papelService.listarDoUsuario(req.params.id);

  resposta.ok(res, papeis.map(mapper.papel), {
    mensagem: criado ? 'Papel concedido.' : 'O usuário já tinha este papel.',
  });
});

const removerPapel = catchAsync(async (req, res) => {
  await papelService.remover(req.contexto, req.params.id, req.params.papel, req.body);
  const papeis = await papelService.listarDoUsuario(req.params.id);

  resposta.ok(res, papeis.map(mapper.papel), { mensagem: 'Papel removido.' });
});

module.exports = {
  eu,
  atualizarEu,
  listar,
  ver,
  atualizar,
  solicitarTrocaEmail,
  confirmarTrocaEmail,
  excluirEu,
  excluir,
  suspender,
  banir,
  restaurar,
  listarPapeis,
  atribuirPapel,
  removerPapel,
};
