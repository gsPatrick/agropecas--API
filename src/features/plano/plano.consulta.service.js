'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const { erros } = require('../../utils/erros');
const { chaves } = require('./plano.cache');
const { PLANO_PADRAO, STATUS_VIGENTES, TTL, normalizarChave } = require('./plano.constants');

/**
 * Leitura de plano: catálogo público e **resolução do plano efetivo** de um
 * usuário.
 *
 * A resolução é o coração do módulo, e a regra que a governa é uma só:
 *
 *   NINGUÉM FICA SEM PLANO.
 *
 * Sem assinatura, com assinatura cancelada, com assinatura vencida — em todos
 * os casos a resposta é o plano padrão (`gratuito_mvp`). O contrário seria
 * transformar um dado faltando em bloqueio de publicação, e no MVP gratuito
 * isso tiraria a plataforma inteira do ar por um registro ausente.
 */

const ATRIBUTOS_PLANO = [
  'id',
  'chave',
  'nome',
  'descricao',
  'preco_centavos',
  'periodicidade',
  'dias_teste',
  'publico',
  'ativo',
  'padrao',
  'ordem',
];

const ATRIBUTOS_LIMITE = ['id', 'plano_id', 'chave', 'valor', 'periodo', 'descricao'];

const incluirLimites = () => ({
  model: db.PlanoLimite,
  as: 'limites',
  attributes: ATRIBUTOS_LIMITE,
  required: false,
});

/** objeto simples — instância do Sequelize nunca vai para o cache (padrão §7) */
const simples = (registro) => (registro ? JSON.parse(JSON.stringify(registro)) : null);

/**
 * Catálogo para a tabela de preços do site.
 *
 * `publico: false` existe para plano negociado caso a caso (um lojista grande
 * com condição própria): ele funciona, mas não aparece na vitrine. Só o Admin
 * enxerga, e é ele quem decide passar `incluirOcultos`.
 */
async function listar({ incluirInativos = false, incluirOcultos = false } = {}) {
  const assinatura = cache.assinatura({ incluirInativos, incluirOcultos });

  return cache.lembrar(
    chaves.catalogo(assinatura),
    async () => {
      const where = {};
      if (!incluirInativos) where.ativo = true;
      if (!incluirOcultos) where.publico = true;

      const planos = await db.Plano.findAll({
        where,
        attributes: ATRIBUTOS_PLANO,
        include: [incluirLimites()],
        order: [
          ['ordem', 'ASC'],
          ['preco_centavos', 'ASC'],
        ],
      });

      return planos.map(simples);
    },
    { ttl: TTL.PLANOS_PUBLICOS }
  );
}

/** por id ou por chave — o Admin usa id, o resto do sistema usa chave */
async function obter(identificador) {
  const ehUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(identificador)
  );

  const plano = await db.Plano.findOne({
    where: ehUuid ? { id: identificador } : { chave: identificador },
    include: [incluirLimites()],
  });

  if (!plano) throw erros.naoEncontrado('Plano');
  return plano;
}

/** o plano que vale para quem não tem assinatura — semeado como `gratuito_mvp` */
async function planoPadrao() {
  const plano =
    (await db.Plano.findOne({
      where: { padrao: true, ativo: true },
      attributes: ATRIBUTOS_PLANO,
      include: [incluirLimites()],
      order: [['ordem', 'ASC']],
    })) ||
    (await db.Plano.findOne({
      where: { chave: PLANO_PADRAO },
      attributes: ATRIBUTOS_PLANO,
      include: [incluirLimites()],
    }));

  return plano;
}

/** assinatura vigente do usuário, ou null — vigente = status ativo e não vencida */
function assinaturaVigente(usuarioId) {
  return db.Assinatura.findOne({
    where: {
      usuario_id: usuarioId,
      status: { [Op.in]: STATUS_VIGENTES },
      [Op.or]: [{ fim_em: null }, { fim_em: { [Op.gt]: new Date() } }],
    },
    include: [
      {
        model: db.Plano,
        as: 'plano',
        attributes: ATRIBUTOS_PLANO,
        include: [incluirLimites()],
      },
    ],
    order: [['inicio_em', 'DESC']],
  });
}

/**
 * Plano efetivo + limites, em objeto simples e cacheável.
 *
 * Devolve o mapa de limites já indexado por chave normalizada para que
 * `podeUsar` seja um acesso a propriedade, e não uma varredura de array a cada
 * publicação.
 *
 * @returns { planoId, planoChave, planoNome, assinaturaId, origem, limites }
 *          `origem`: 'assinatura' | 'padrao' | 'nenhum'
 */
async function planoEfetivo(usuarioId) {
  return cache.lembrar(
    chaves.limitesDoUsuario(usuarioId),
    async () => {
      const assinatura = usuarioId ? await assinaturaVigente(usuarioId) : null;
      const plano = assinatura?.plano || (await planoPadrao());

      /* banco sem plano padrão semeado: devolvemos estrutura vazia em vez de
         lançar. Quem pergunta é o fluxo de publicação, e derrubar a publicação
         de todo mundo por causa de um seeder que não rodou é o oposto do que
         este módulo existe para garantir */
      if (!plano) {
        return { planoId: null, planoChave: null, planoNome: null, assinaturaId: null, origem: 'nenhum', limites: {} };
      }

      const limites = {};
      (plano.limites || []).forEach((limite) => {
        limites[normalizarChave(limite.chave)] = {
          chave: normalizarChave(limite.chave),
          valor: limite.valor === null || limite.valor === undefined ? null : Number(limite.valor),
          periodo: limite.periodo || 'total',
          descricao: limite.descricao || null,
        };
      });

      return {
        planoId: plano.id,
        planoChave: plano.chave,
        planoNome: plano.nome,
        assinaturaId: assinatura ? assinatura.id : null,
        origem: assinatura ? 'assinatura' : 'padrao',
        limites,
      };
    },
    { ttl: TTL.LIMITES_DO_USUARIO }
  );
}

module.exports = {
  listar,
  obter,
  planoPadrao,
  assinaturaVigente,
  planoEfetivo,
  ATRIBUTOS_PLANO,
  ATRIBUTOS_LIMITE,
};
