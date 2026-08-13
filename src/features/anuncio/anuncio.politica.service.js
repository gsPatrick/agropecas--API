'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const { erros } = require('../../utils/erros');
const { adicionarDias } = require('../../utils/datas');
const { chaves } = require('./anuncio.cache');
const { CONFIG, PADRAO, LIMITE, STATUS_ATIVOS, TTL } = require('./anuncio.constants');

/**
 * Regras paramétricas do anúncio: prazo de validade, teto de fotos e quota do
 * plano.
 *
 * Nada disso é constante de código de propósito. Prazo de expiração é decisão
 * comercial que muda em campanha de safra; se estivesse num `const`, mudar
 * exigiria deploy, e mudar em produção viraria "hotfix". Aqui é dado editável.
 *
 * DEPENDÊNCIA: os módulos `configuracao` e `plano` estão sendo construídos em
 * paralelo. Enquanto não existirem, este service lê `configuracoes` e
 * `plano_limites` diretamente pelo model. Hoje a quota já vem do módulo
 * `plano`; o prazo e o teto de fotos ainda leem `configuracoes` direto. Só as
 * de leitura abaixo mudam — nenhum outro arquivo da feature toca no banco por
 * causa disso.
 */

/** lê uma chave de `configuracoes`, com cache curto e valor de queda */
async function configurado(chave, padrao) {
  const valor = await cache.lembrar(
    chaves.configuracao(chave),
    async () => {
      const linha = await db.Configuracao.findOne({
        where: { chave },
        attributes: ['valor'],
      }).catch(() => null);

      /* `valor` é JSONB: `null` é resposta legítima (significa "ilimitado" em
         max_ativos). Envelopar evita que o cache confunda ausência com nulo */
      return { encontrado: Boolean(linha), valor: linha ? linha.valor : null };
    },
    { ttl: TTL.CONFIGURACAO }
  );

  return valor.encontrado ? valor.valor : padrao;
}

const diasValidade = () => configurado(CONFIG.DIAS_VALIDADE, PADRAO.DIAS_VALIDADE);

const maxFotos = () => configurado(CONFIG.MAX_FOTOS, PADRAO.MAX_FOTOS);

const moderacaoPrevia = () => configurado(CONFIG.MODERACAO_PREVIA, PADRAO.MODERACAO_PREVIA);

/** data em que o anúncio publicado agora deixa de aparecer */
async function calcularExpiracao(base = new Date()) {
  const dias = Number(await diasValidade()) || PADRAO.DIAS_VALIDADE;
  return adicionarDias(dias, base);
}

/**
 * Quota do plano do usuário para uma chave de limite.
 * `null` é ILIMITADO — é o caso de todo mundo no MVP (`gratuito_mvp`).
 *
 * Delega ao módulo `plano`, que é o dono dessa regra. A versão anterior lia
 * `assinaturas` e `plano_limites` direto pelos models porque o módulo ainda não
 * existia; manter as duas implementações garantiria que um dia elas
 * divergissem — e divergência aqui significa dois lugares decidindo quem pode
 * publicar.
 *
 * O módulo `plano` também trata o que este arquivo não tratava: cache,
 * assinatura em período de teste, chave não cadastrada como ilimitada e
 * degradação (falha de infraestrutura libera em vez de travar a publicação).
 */
async function limiteDoPlano(usuarioId, chaveLimite) {
  const plano = require('../plano');
  const veredito = await plano.podeUsar(usuarioId, chaveLimite);

  return veredito.ilimitado ? null : veredito.limite;
}

/**
 * Barra a publicação quando o usuário já bateu a quota de anúncios ativos.
 *
 * Conferido no PUBLICAR e não no CRIAR: rascunho não ocupa vitrine e travar a
 * criação impediria o usuário de preparar o próximo anúncio enquanto decide
 * qual pausar.
 *
 * O `anuncioId` em curso é excluído da contagem — republicar um anúncio que já
 * estava ativo não consome uma vaga nova.
 */
async function garantirLimiteDePublicacao(usuarioId, { anuncioId } = {}) {
  const doPlano = await limiteDoPlano(usuarioId, LIMITE.ANUNCIOS_ATIVOS);
  const daConfiguracao = await configurado(CONFIG.MAX_ATIVOS, null);

  /* o menor teto vence: configuração global é freio de emergência do Admin e
     não pode ser contornada por um plano generoso */
  const tetos = [doPlano, daConfiguracao].filter((valor) => valor !== null && valor !== undefined);
  if (!tetos.length) return { limite: null, usados: null };

  const limite = Math.min(...tetos.map(Number));

  const where = { usuario_id: usuarioId, status: { [Op.in]: STATUS_ATIVOS } };
  if (anuncioId) where.id = { [Op.ne]: anuncioId };

  const usados = await db.Anuncio.count({ where });

  if (usados >= limite) {
    throw erros.conflito(
      `Seu plano permite ${limite} anúncio(s) ativo(s). Pause ou remova um para publicar outro.`,
      { code: 'LIMITE_DO_PLANO', limite, usados }
    );
  }

  return { limite, usados };
}

/** teto de fotos: o menor entre o plano e a configuração global */
async function limiteDeFotos(usuarioId) {
  const doPlano = await limiteDoPlano(usuarioId, LIMITE.FOTOS_POR_ANUNCIO);
  const daConfiguracao = Number(await maxFotos()) || PADRAO.MAX_FOTOS;

  return doPlano === null ? daConfiguracao : Math.min(Number(doPlano), daConfiguracao);
}

module.exports = {
  diasValidade,
  maxFotos,
  moderacaoPrevia,
  calcularExpiracao,
  limiteDoPlano,
  garantirLimiteDePublicacao,
  limiteDeFotos,
};
