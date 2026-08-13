'use strict';

const db = require('../../models');
const cache = require('../../cache');
const consultaService = require('./plano.consulta.service');
const { chaves, invalidarUso } = require('./plano.cache');
const { balde } = require('./plano.comum');
const { TTL, normalizarChave } = require('./plano.constants');

/**
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  API INTERNA DE LIMITE — contrato consumido por OUTROS MÓDULOS         │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ```js
 * const plano = require('../plano');   // barril da feature
 *
 * // antes de deixar publicar
 * const { permitido, limite, usado, restante } =
 *   await plano.podeUsar(ctx.usuarioId, 'anuncios.ativos');
 * if (!permitido) throw plano.erroDeLimite(...);
 *
 * // depois de publicar de verdade (dentro da mesma transação, se houver)
 * await plano.registrarUso(ctx.usuarioId, 'anuncios.ativos', 1, { transacao });
 *
 * // ao despublicar/remover, devolve a vaga
 * await plano.registrarUso(ctx.usuarioId, 'anuncios.ativos', -1);
 * ```
 *
 * **Três invariantes que este arquivo garante e ninguém deve reimplementar:**
 *
 * 1. `limite = null` é ILIMITADO, jamais zero. É o caso de quase tudo no MVP
 *    gratuito; tratar null como 0 travaria a plataforma inteira.
 * 2. Chave de limite **não cadastrada** também é ilimitada. Um módulo novo
 *    pode perguntar por uma quota que o Admin ainda não criou, e a resposta
 *    correta no MVP é "pode".
 * 3. Usuário **sem assinatura** cai no plano padrão. Ver
 *    `plano.consulta.service.js`.
 *
 * `podeUsar` NUNCA lança por falha de infraestrutura: se o banco ou o cache
 * derem erro, a resposta é "permitido" com `degradado: true`. Um verificador
 * de quota que impede publicar quando o Redis cai causa mais prejuízo do que
 * a quota que ele protege — e o MVP não cobra por nada.
 */

/** resposta padrão de "pode, sem teto" — usada em vários caminhos */
const semTeto = (chave, extras = {}) => ({
  chave,
  permitido: true,
  ilimitado: true,
  limite: null,
  usado: 0,
  restante: null,
  periodo: 'total',
  ...extras,
});

/**
 * Quanto já foi consumido desta chave no balde corrente.
 *
 * Cache curto (20s) porque é lido a cada publicação e invalidado por
 * `registrarUso` — o TTL só cobre o caso de duas instâncias e um Redis que
 * perdeu a invalidação.
 */
async function usoAtual(usuarioId, chave, periodo) {
  const janela = balde(periodo);

  const quantidade = await cache.lembrar(
    chaves.uso(usuarioId, chave, janela.inicio),
    async () => {
      const registro = await db.UsoMedido.findOne({
        where: { usuario_id: usuarioId, chave, periodo_inicio: janela.inicio },
        attributes: ['quantidade'],
      });
      return registro ? Number(registro.quantidade) : 0;
    },
    { ttl: TTL.USO, cachearVazio: true }
  );

  return { quantidade: Number(quantidade) || 0, janela };
}

/**
 * Este usuário pode consumir mais `quantidade` desta chave?
 *
 * @param {string} usuarioId
 * @param {string} chave       'anuncios.ativos' (aceita 'anuncios_ativos')
 * @param {number} quantidade  quanto pretende consumir agora (padrão 1)
 *
 * Quando o limite é ilimitado, `usado` volta 0 e NENHUMA consulta de uso é
 * feita — contar consumo que não influencia decisão nenhuma seria um SELECT a
 * mais em toda publicação do MVP inteiro, já que hoje quase tudo é ilimitado.
 * Quem quer o número real (a tela "meu uso") chama `panorama`.
 *
 * @returns {Promise<{
 *   permitido: boolean, ilimitado: boolean,
 *   limite: number|null, usado: number, restante: number|null,
 *   chave: string, periodo: string, planoChave: string|null,
 *   degradado?: boolean
 * }>}
 */
async function podeUsar(usuarioId, chave, quantidade = 1) {
  const alvo = normalizarChave(chave);
  const quanto = Number.isFinite(Number(quantidade)) ? Math.trunc(Number(quantidade)) : 1;

  try {
    /* visitante não tem plano nem uso: quem barra visitante é a autenticação,
       não a quota — devolver "não pode" aqui daria 403 por motivo errado */
    if (!usuarioId) return semTeto(alvo, { planoChave: null });

    const efetivo = await consultaService.planoEfetivo(usuarioId);
    const limite = efetivo.limites[alvo];

    // invariantes 1 e 2: sem limite cadastrado, ou valor null → ilimitado
    if (!limite || limite.valor === null || limite.valor === undefined) {
      return semTeto(alvo, {
        planoChave: efetivo.planoChave,
        periodo: limite?.periodo || 'total',
      });
    }

    const teto = Number(limite.valor);
    const { quantidade: usado } = await usoAtual(usuarioId, alvo, limite.periodo);

    return {
      chave: alvo,
      permitido: usado + quanto <= teto,
      ilimitado: false,
      limite: teto,
      usado,
      restante: Math.max(0, teto - usado),
      periodo: limite.periodo,
      planoChave: efetivo.planoChave,
    };
  } catch (erro) {
    console.error('[plano] falha ao apurar limite, liberando', { usuarioId, chave: alvo, mensagem: erro.message });
    return { ...semTeto(alvo, { planoChave: null }), degradado: true };
  }
}

/**
 * Registra consumo. Aceita negativo para devolver a vaga (anúncio pausado,
 * foto removida).
 *
 * O contador sobe com **um UPDATE atômico** (`quantidade + n`, com piso em
 * zero) e não com ler-somar-gravar: duas publicações simultâneas do mesmo
 * usuário em instâncias diferentes leriam o mesmo valor e gravariam o mesmo
 * resultado, e a quota valeria o dobro.
 *
 * @param opcoes.transacao  participa da transação de quem chama, para que o
 *                          contador não suba se a publicação der rollback
 * @returns {Promise<{ chave, quantidade, periodoInicio, periodoFim }>}
 */
async function registrarUso(usuarioId, chave, quantidade = 1, { transacao = null, periodo } = {}) {
  const alvo = normalizarChave(chave);
  const quanto = Math.trunc(Number(quantidade) || 0);

  if (!usuarioId) throw new Error('registrarUso: usuarioId é obrigatório.');
  if (!alvo) throw new Error('registrarUso: chave é obrigatória.');
  if (!quanto) return { chave: alvo, quantidade: 0, periodoInicio: null, periodoFim: null };

  /* o período vem do limite cadastrado, não de quem chama: se o Admin mudar
     `anuncios.por_mes` de mensal para semanal, o balde muda junto sem que o
     módulo de anúncio precise saber */
  const efetivo = await consultaService.planoEfetivo(usuarioId).catch(() => ({ limites: {} }));
  const janela = balde(periodo || efetivo.limites[alvo]?.periodo || 'total');

  await db.UsoMedido.findOrCreate({
    where: { usuario_id: usuarioId, chave: alvo, periodo_inicio: janela.inicio },
    defaults: {
      usuario_id: usuarioId,
      chave: alvo,
      periodo_inicio: janela.inicio,
      periodo_fim: janela.fim,
      quantidade: 0,
    },
    transaction: transacao,
  });

  /* GREATEST(...,0) no banco e não em JS: devolver vaga duas vezes por engano
     não pode deixar o contador negativo, e corrigir depois exigiria saber que
     ficou negativo */
  await db.UsoMedido.update(
    {
      quantidade: db.Sequelize.literal(`GREATEST("quantidade" + (${quanto}), 0)`),
      periodo_fim: janela.fim,
    },
    {
      where: { usuario_id: usuarioId, chave: alvo, periodo_inicio: janela.inicio },
      transaction: transacao,
    }
  );

  await invalidarUso(usuarioId, alvo, janela.inicio);

  const atual = await db.UsoMedido.findOne({
    where: { usuario_id: usuarioId, chave: alvo, periodo_inicio: janela.inicio },
    attributes: ['quantidade'],
    transaction: transacao,
  });

  return {
    chave: alvo,
    quantidade: atual ? Number(atual.quantidade) : 0,
    periodoInicio: janela.inicio,
    periodoFim: janela.fim,
  };
}

/**
 * Atalho para quem quer só barrar: verifica e lança 403 se estourou.
 *
 * Existe para que o módulo de anúncio não precise repetir a mesma mensagem em
 * cinco lugares — e para que a mensagem que o usuário lê seja a mesma em todos.
 */
async function exigirLimite(usuarioId, chave, quantidade = 1) {
  const resultado = await podeUsar(usuarioId, chave, quantidade);
  if (resultado.permitido) return resultado;

  const { erros } = require('../../utils/erros');
  throw erros.semPermissao(
    `Seu plano permite ${resultado.limite} neste item e você já usou ${resultado.usado}.`,
    { limite: resultado.chave, valor: resultado.limite, usado: resultado.usado, plano: resultado.planoChave }
  );
}

module.exports = { podeUsar, registrarUso, exigirLimite, usoAtual };
