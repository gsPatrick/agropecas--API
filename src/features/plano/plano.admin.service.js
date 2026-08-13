'use strict';

const db = require('../../models');
const auditoria = require('../auditoria/auditoria.service');
const consultaService = require('./plano.consulta.service');
const { erros } = require('../../utils/erros');
const { invalidarPlanos } = require('./plano.cache');
const { AUDITORIA, normalizarChave } = require('./plano.constants');

/**
 * CRUD de plano e de limites — exclusivo do Admin.
 *
 * Toda alteração aqui muda o teto de MUITAS contas de uma vez: baixar
 * `anuncios.ativos` de ilimitado para 3 despublica ninguém, mas impede
 * publicação de todo mundo no instante seguinte. Por isso as três decisões
 * deste arquivo:
 *
 * 1. **tudo é auditado**, com `antes` e `depois`, para que dê para responder
 *    "quem baixou meu limite e quando";
 * 2. **remoção é lógica** (o model é `paranoid`) — apagar plano de verdade
 *    deixaria assinatura apontando para nada;
 * 3. **o cache cai na escrita**, nunca esperando o TTL.
 */

/**
 * Só os campos que o Admin pode escrever, e o nome de coluna de cada um.
 *
 * Lista branca explícita e não `{ ...dados }`: sem ela, mandar
 * `{ padrao: true }` no corpo trocaria o plano padrão da plataforma por um
 * caminho que ninguém escreveu de propósito.
 */
const CAMPOS_EDITAVEIS = {
  nome: 'nome',
  descricao: 'descricao',
  precoCentavos: 'preco_centavos',
  periodicidade: 'periodicidade',
  diasTeste: 'dias_teste',
  publico: 'publico',
  ativo: 'ativo',
  ordem: 'ordem',
};

/** entrada da API (camelCase) → colunas do model */
const paraColunas = (dados = {}) =>
  Object.entries(CAMPOS_EDITAVEIS).reduce((acumulado, [entrada, coluna]) => {
    if (dados[entrada] !== undefined) acumulado[coluna] = dados[entrada];
    return acumulado;
  }, {});

const retrato = (plano) => ({
  chave: plano.chave,
  nome: plano.nome,
  preco_centavos: plano.preco_centavos,
  periodicidade: plano.periodicidade,
  publico: plano.publico,
  ativo: plano.ativo,
  padrao: plano.padrao,
});

async function criar(dados, contexto) {
  const chave = normalizarChave(dados.chave).replace(/\./g, '_');

  const existente = await db.Plano.findOne({ where: { chave }, paranoid: false });
  if (existente) throw erros.conflito('Já existe um plano com esta chave.');

  /* plano nasce sem `padrao`: trocar o plano padrão da plataforma é operação
     à parte (`definirPadrao`), porque afeta todo cadastro futuro e não pode
     acontecer como efeito colateral de criar um plano qualquer */
  const plano = await db.Plano.create({ ...paraColunas(dados), chave, padrao: false });

  if (Array.isArray(dados.limites) && dados.limites.length) {
    await definirLimites(plano.id, dados.limites, contexto, { auditar: false });
  }

  await invalidarPlanos();
  await auditoria.registrar(contexto, {
    acao: AUDITORIA.CRIAR,
    entidade: 'plano',
    entidadeId: plano.id,
    depois: retrato(plano),
  });

  return consultaService.obter(plano.id);
}

async function editar(id, dados, contexto) {
  const plano = await consultaService.obter(id);
  const antes = retrato(plano);

  const mudancas = paraColunas(dados);

  /* desativar o plano padrão deixaria os cadastros novos sem plano, e o
     `planoEfetivo` cairia no caminho degradado sem que ninguém percebesse */
  if (plano.padrao && mudancas.ativo === false) {
    throw erros.invalido('O plano padrão da plataforma não pode ser desativado.');
  }

  await plano.update(mudancas);

  if (Array.isArray(dados.limites)) {
    await definirLimites(plano.id, dados.limites, contexto, { auditar: false });
  }

  await invalidarPlanos();
  await auditoria.registrar(contexto, {
    acao: AUDITORIA.EDITAR,
    entidade: 'plano',
    entidadeId: plano.id,
    antes,
    depois: retrato(plano),
  });

  return consultaService.obter(plano.id);
}

async function remover(id, contexto, { motivo } = {}) {
  const plano = await consultaService.obter(id);

  if (plano.padrao) throw erros.invalido('O plano padrão da plataforma não pode ser removido.');

  const assinantes = await db.Assinatura.count({ where: { plano_id: plano.id, status: 'ativa' } });
  if (assinantes > 0) {
    throw erros.conflito(
      `Este plano tem ${assinantes} assinatura(s) ativa(s). Mova essas contas para outro plano antes de remover.`
    );
  }

  await plano.destroy(); // lógico: `planos` é paranoid

  await invalidarPlanos();
  await auditoria.registrar(contexto, {
    acao: AUDITORIA.REMOVER,
    entidade: 'plano',
    entidadeId: plano.id,
    antes: retrato(plano),
    motivo,
  });

  return { removido: true, id: plano.id };
}

/**
 * Define os limites do plano — **substituição completa**, não merge.
 *
 * A lista enviada passa a ser a verdade: o que não veio é apagado. É o que
 * torna a tela do Admin previsível ("o que estou vendo é o que vale") e evita
 * limite fantasma que ninguém consegue remover porque a API só sabia somar.
 *
 * `valor: null` grava ILIMITADO — não é campo faltando, é decisão.
 */
async function definirLimites(planoId, limites, contexto, { auditar = true } = {}) {
  const plano = await consultaService.obter(planoId);
  const antes = (plano.limites || []).map((limite) => ({ chave: limite.chave, valor: limite.valor, periodo: limite.periodo }));

  const normalizados = limites.map((limite) => ({
    plano_id: plano.id,
    chave: normalizarChave(limite.chave),
    valor: limite.valor === null || limite.valor === undefined ? null : Math.trunc(Number(limite.valor)),
    periodo: limite.periodo || 'total',
    descricao: limite.descricao || null,
  }));

  const duplicada = normalizados.find(
    (limite, indice) => normalizados.findIndex((outro) => outro.chave === limite.chave) !== indice
  );
  if (duplicada) throw erros.invalido(`Limite duplicado: ${duplicada.chave}.`);

  /* transação porque são duas escritas: apagar e regravar. Sem ela, uma falha
     no meio deixaria o plano SEM limite nenhum — que por regra deste módulo
     significa "ilimitado", ou seja, a falha abriria a porteira em silêncio */
  await db.sequelize.transaction(async (transacao) => {
    await db.PlanoLimite.destroy({ where: { plano_id: plano.id }, transaction: transacao });
    if (normalizados.length) {
      await db.PlanoLimite.bulkCreate(normalizados, { transaction: transacao });
    }
  });

  await invalidarPlanos();

  if (auditar) {
    await auditoria.registrar(contexto, {
      acao: AUDITORIA.LIMITES_DEFINIR,
      entidade: 'plano',
      entidadeId: plano.id,
      antes: { limites: antes },
      depois: { limites: normalizados.map(({ chave, valor, periodo }) => ({ chave, valor, periodo })) },
    });
  }

  return consultaService.obter(plano.id);
}

module.exports = { criar, editar, remover, definirLimites };
