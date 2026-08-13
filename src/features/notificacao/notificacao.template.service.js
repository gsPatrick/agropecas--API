'use strict';

const db = require('../../models');
const cache = require('../../cache');
const { erros } = require('../../utils/erros');
const auditoria = require('../auditoria/auditoria.service');
const { chaves } = require('./notificacao.cache');

/**
 * Templates de notificação — o texto de cada aviso, editável pelo Admin.
 *
 * Texto dentro do código significa deploy para corrigir uma vírgula, e tira da
 * cliente o controle do tom das mensagens que saem no nome da plataforma.
 *
 * A renderização é PROPOSITALMENTE burra: substituição de `{{chave}}` e nada
 * mais. Um motor de template de verdade (com condicional e laço) num texto que
 * o Admin edita pela web é execução de código de terceiro dentro do servidor —
 * o ganho não paga o risco.
 */

/** `{{nome}}` → valor. Chave ausente vira string vazia, nunca "{{nome}}" na tela. */
function renderizar(texto, dados = {}) {
  if (!texto) return texto;

  return String(texto).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_completo, chave) => {
    const valor = chave
      .split('.')
      .reduce((atual, parte) => (atual == null ? undefined : atual[parte]), dados);

    return valor === undefined || valor === null ? '' : String(valor);
  });
}

/**
 * Template ativo de um tipo+canal, em cache.
 *
 * Lido na criação de toda notificação que não traz texto pronto; escrito só
 * quando o Admin salva a tela. Relação leitura/escrita altíssima, então o TTL
 * pode ser generoso — e a invalidação na escrita garante que a edição apareça
 * na hora.
 */
async function ativo(tipo, canal) {
  return cache.lembrar(
    chaves.template(tipo, canal),
    async () => {
      const registro = await db.TemplateNotificacao.findOne({
        where: { tipo, canal, ativo: true },
        attributes: ['id', 'tipo', 'canal', 'assunto', 'titulo', 'corpo', 'corpo_html'],
        raw: true,
      });
      return registro || null;
    },
    { ttl: 600, cachearVazio: true }
  );
}

/**
 * Monta título e corpo de uma notificação.
 *
 * Texto explícito de quem chamou tem precedência sobre o template: o módulo de
 * conversa sabe o nome do anúncio, o template não. O template é o padrão para
 * quem só informou o tipo.
 */
async function montar({ tipo, canal, titulo, mensagem, dados }) {
  const modelo = await ativo(tipo, canal);

  return {
    titulo: (titulo || renderizar(modelo?.titulo, dados) || '').slice(0, 160) || null,
    corpo: mensagem || renderizar(modelo?.corpo, dados) || null,
    assunto: (renderizar(modelo?.assunto, dados) || titulo || '').slice(0, 180) || null,
    corpoHtml: renderizar(modelo?.corpo_html, dados) || null,
  };
}

// ─── CRUD do Admin ────────────────────────────────────────────

const listar = () =>
  db.TemplateNotificacao.findAll({ order: [['tipo', 'ASC'], ['canal', 'ASC']] });

async function obter(id) {
  const registro = await db.TemplateNotificacao.findByPk(id);
  if (!registro) throw erros.naoEncontrado('Template');
  return registro;
}

async function criar(contexto, dados) {
  const existente = await db.TemplateNotificacao.findOne({
    where: { tipo: dados.tipo, canal: dados.canal },
  });

  /* o índice é único em (tipo, canal): deixar o banco estourar devolveria 500
     onde o correto é dizer "já existe, edite aquele" */
  if (existente) {
    throw erros.conflito('Já existe um template para este tipo e canal.', {
      templateId: existente.id,
    });
  }

  const registro = await db.TemplateNotificacao.create({
    ...dados,
    atualizado_por: contexto.usuarioId,
  });

  await cache.remover(chaves.template(registro.tipo, registro.canal));
  await auditoria.registrar(contexto, {
    acao: 'criar',
    entidade: 'templates_notificacao',
    entidadeId: registro.id,
    depois: { tipo: registro.tipo, canal: registro.canal },
  });

  return registro;
}

async function atualizar(contexto, id, dados) {
  const registro = await obter(id);
  const antes = { titulo: registro.titulo, corpo: registro.corpo, ativo: registro.ativo };

  await registro.update({ ...dados, atualizado_por: contexto.usuarioId });
  await cache.remover(chaves.template(registro.tipo, registro.canal));

  /* editar o texto que sai para milhares de pessoas é ação sensível: sem
     trilha, ninguém sabe quem trocou o aviso de suspensão de conta */
  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: 'templates_notificacao',
    entidadeId: registro.id,
    antes,
    depois: { titulo: registro.titulo, corpo: registro.corpo, ativo: registro.ativo },
  });

  return registro;
}

async function remover(contexto, id) {
  const registro = await obter(id);

  await registro.destroy();
  await cache.remover(chaves.template(registro.tipo, registro.canal));
  await auditoria.registrar(contexto, {
    acao: 'remover',
    entidade: 'templates_notificacao',
    entidadeId: id,
    antes: { tipo: registro.tipo, canal: registro.canal },
  });

  return true;
}

module.exports = { renderizar, ativo, montar, listar, obter, criar, atualizar, remover };
