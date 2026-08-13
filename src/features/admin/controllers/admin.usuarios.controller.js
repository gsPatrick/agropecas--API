'use strict';

const usuariosService = require('../services/admin.usuarios.service');
const acoesService = require('../services/admin.usuarios.acoes.service');
const papeisService = require('../services/admin.usuarios.papeis.service');
const perfisService = require('../services/admin.perfis.service');

const usuarioMapper = require('../../usuario/usuario.mapper');
const auditoriaMapper = require('../../auditoria/auditoria.mapper');

const catchAsync = require('../../../utils/catch-async');
const resposta = require('../../../utils/resposta');

/**
 * Controller de contas e perfis do painel — camada HTTP e **só ela**.
 *
 * Duas regras que este arquivo obedece sem exceção:
 *
 * 1. **`usuario_id` nunca vem do corpo.** O autor da ação é sempre
 *    `req.contexto.usuarioId`; o alvo é sempre `req.params.id`. Id de dono
 *    lido do `body` é escalada de privilégio de graça.
 * 2. **Nenhuma decisão de permissão aqui.** O que parece decisão — passar ou
 *    não `req.params.id` adiante — é só encaminhamento; quem julga é o RBAC
 *    dentro do service, onde o dono do registro é conhecido.
 */

const listar = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await usuariosService.listar(req.contexto, req.query);
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

/**
 * Ficha completa. O mapper `ficha` traz `motivoStatus`, que o titular não vê
 * na própria conta de propósito — o texto é anotação de quem moderou.
 */
const ver = catchAsync(async (req, res) => {
  const { usuario, perfil, contadores, plano } = await usuariosService.ver(req.contexto, req.params.id);

  resposta.ok(res, { ...usuarioMapper.ficha(usuario), perfil, contadores, plano });
});

const atividade = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await usuariosService.atividade(
    req.contexto,
    req.params.id,
    req.query
  );

  resposta.paginado(res, itens.map(auditoriaMapper.linha), { pagina, porPagina, total });
});

const editar = catchAsync(async (req, res) => {
  const usuario = await acoesService.editar(req.contexto, req.params.id, req.body);
  resposta.ok(res, usuarioMapper.ficha(usuario), { mensagem: 'Cadastro atualizado.' });
});

const suspender = catchAsync(async (req, res) => {
  const { usuario, sessoesEncerradas } = await acoesService.suspender(
    req.contexto,
    req.params.id,
    req.body
  );

  resposta.ok(res, { usuario: usuarioMapper.ficha(usuario), sessoesEncerradas });
});

const banir = catchAsync(async (req, res) => {
  const { usuario, sessoesEncerradas } = await acoesService.banir(req.contexto, req.params.id, req.body);
  resposta.ok(res, { usuario: usuarioMapper.ficha(usuario), sessoesEncerradas });
});

const restaurar = catchAsync(async (req, res) => {
  const { usuario } = await acoesService.restaurar(req.contexto, req.params.id, req.body);
  resposta.ok(res, usuarioMapper.ficha(usuario), { mensagem: 'Conta reativada.' });
});

const encerrarSessoes = catchAsync(async (req, res) => {
  const dados = await acoesService.encerrarSessoes(req.contexto, req.params.id);
  resposta.ok(res, dados, { mensagem: 'Sessões encerradas.' });
});

// ─── PAPÉIS ────────────────────────────────────────────────────

const listarPapeis = catchAsync(async (req, res) => {
  const papeis = await papeisService.listar(req.contexto, req.params.id);
  resposta.ok(res, papeis.map(usuarioMapper.papel));
});

const atribuirPapel = catchAsync(async (req, res) => {
  const { papeis, criado } = await papeisService.atribuir(req.contexto, req.params.id, req.body);

  resposta.ok(res, papeis.map(usuarioMapper.papel), {
    mensagem: criado ? 'Papel concedido.' : 'O usuário já tinha este papel.',
  });
});

const removerPapel = catchAsync(async (req, res) => {
  const { papeis } = await papeisService.remover(
    req.contexto,
    req.params.id,
    req.params.papel,
    req.body
  );

  resposta.ok(res, papeis.map(usuarioMapper.papel), { mensagem: 'Papel removido.' });
});

// ─── LOTE ──────────────────────────────────────────────────────

/**
 * Sanção em massa. Os ids vêm do corpo porque são ALVOS, não donos — e cada um
 * deles passa pelas mesmas travas da sanção individual antes de qualquer
 * escrita.
 */
const sancionarEmLote = catchAsync(async (req, res) => {
  const dados = await acoesService.sancionarEmLote(req.contexto, req.body);
  resposta.ok(res, dados, { mensagem: `${dados.aplicados} conta(s) afetada(s).` });
});

// ─── PERFIS ────────────────────────────────────────────────────

const listarPerfis = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await perfisService.listar(req.contexto, req.query);
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const verificarPerfil = catchAsync(async (req, res) => {
  const perfil = await perfisService.verificar(req.contexto, req.params.id, req.body);
  resposta.ok(res, perfisService.linha(perfil), { mensagem: 'Perfil verificado.' });
});

const revogarVerificacao = catchAsync(async (req, res) => {
  const perfil = await perfisService.revogar(req.contexto, req.params.id, req.body);
  resposta.ok(res, perfisService.linha(perfil), { mensagem: 'Verificação revogada.' });
});

module.exports = {
  listar,
  ver,
  atividade,
  editar,
  suspender,
  banir,
  restaurar,
  encerrarSessoes,
  listarPapeis,
  atribuirPapel,
  removerPapel,
  sancionarEmLote,
  listarPerfis,
  verificarPerfil,
  revogarVerificacao,
};
