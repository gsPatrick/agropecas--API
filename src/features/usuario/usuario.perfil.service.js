'use strict';

const db = require('../../models');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { capitalizarNome } = require('../../utils/texto');
const auditoria = require('../auditoria/auditoria.service');
const tempoReal = require('../../tempo-real');
const { CAMPOS_EDITAVEIS, STATUS_SEM_ACESSO } = require('./usuario.constants');

/**
 * Dados cadastrais da conta — o que sobra depois que o auth cuidou de entrar,
 * sair e senha.
 *
 * E-mail **não** se altera por aqui: trocar o e-mail muda a chave de
 * recuperação da conta e exige reconfirmação, o que é fluxo próprio
 * (`usuario.email.service.js`). Deixar `email` cair no mesmo `update` do nome
 * seria o jeito mais discreto de perder uma conta.
 */

/** corpo da API (camelCase) → colunas, só o que é editável pelo titular */
function montarAlteracao(dados) {
  const alteracao = {};

  if (dados.nome !== undefined) alteracao.nome = capitalizarNome(dados.nome);
  if (dados.telefone !== undefined) alteracao.telefone = dados.telefone || null;
  if (dados.whatsapp !== undefined) alteracao.whatsapp = dados.whatsapp || null;
  if (dados.idioma !== undefined) alteracao.idioma = dados.idioma;
  if (dados.fusoHorario !== undefined) alteracao.fuso_horario = dados.fusoHorario;

  return alteracao;
}

/** só o que mudou de fato — auditoria com `antes` igual a `depois` é ruído */
const recortar = (registro, chaves) =>
  chaves.reduce((acumulado, chave) => ({ ...acumulado, [chave]: registro[chave] }), {});

/**
 * @param alvoId  quando ausente, é o próprio titular. Nunca vem do corpo:
 *                id de dono lido do `body` é escalada de privilégio de graça.
 */
async function atualizar(contexto, dados, alvoId) {
  const id = alvoId || contexto.usuarioId;

  /* capacidade conferida ANTES de tocar no banco: assim a resposta é a mesma
     (403) para id existente e inexistente, e o endpoint não vira sonda de
     "quem tem conta aqui" */
  exigir(contexto, 'usuario.editar', { donoId: id });

  const usuario = await db.Usuario.findByPk(id);
  if (!usuario) throw erros.naoEncontrado('Usuário');

  if (STATUS_SEM_ACESSO.includes(usuario.status) && String(id) === String(contexto.usuarioId)) {
    throw erros.contaBloqueada('Esta conta não está ativa.');
  }

  const alteracao = montarAlteracao(dados);
  if (!Object.keys(alteracao).length) return usuario;

  const antes = recortar(usuario, Object.keys(alteracao).filter((chave) => CAMPOS_EDITAVEIS.includes(chave)));
  await usuario.update(alteracao);

  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: 'usuarios',
    entidadeId: usuario.id,
    antes,
    depois: alteracao,
    /* quando o Admin edita a conta de outra pessoa, o rastro precisa dizer
       por quem ele agiu — RBAC.md §2 */
    emNomeDe: String(id) !== String(contexto.usuarioId) ? id : null,
  });

  /* o dado já está gravado; o evento é entrega complementar para a aba aberta
     em outro aparelho não continuar mostrando o telefone antigo */
  tempoReal.paraUsuario(usuario.id, tempoReal.EVENTOS.CONTA_ATUALIZADA, {
    campos: Object.keys(alteracao),
  });

  return usuario;
}

module.exports = { atualizar, montarAlteracao };
