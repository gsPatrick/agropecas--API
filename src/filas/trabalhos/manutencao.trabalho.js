'use strict';

const { Op } = require('sequelize');
const { registrar } = require('../registro');
const { FILAS } = require('../definicoes');

/**
 * Rotinas periódicas de higiene.
 *
 * Todas seguem a mesma regra: **apagam lixo técnico, nunca dado do titular**.
 * Sessão vencida e código usado não são dado pessoal relevante; anúncio,
 * mensagem e consentimento não passam por aqui — quem cuida deles é o módulo
 * de LGPD, com anonimização e prazo próprio.
 */

const LIMPAR_SESSOES = registrar(
  'manutencao.limparSessoes',
  async () => {
    const db = require('../../models');

    /* sessão vencida há mais de 30 dias não serve nem para auditoria: o que
       importa (quem entrou, quando) está em `tentativas_login` */
    const corte = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const removidas = await db.Sessao.destroy({
      where: {
        [Op.or]: [{ expira_em: { [Op.lt]: corte } }, { revogada_em: { [Op.lt]: corte } }],
      },
    });

    return { removidas };
  },
  { fila: FILAS.MANUTENCAO.nome }
);

const LIMPAR_TOKENS = registrar(
  'manutencao.limparTokens',
  async () => {
    const db = require('../../models');
    const corte = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const removidos = await db.TokenVerificacao.destroy({
      where: { expira_em: { [Op.lt]: corte } },
    });

    return { removidos };
  },
  { fila: FILAS.MANUTENCAO.nome }
);

const DESBLOQUEAR_CONTAS = registrar(
  'manutencao.desbloquearContas',
  async () => {
    const db = require('../../models');

    /* o login já destrava sozinho ao ver o prazo vencido; isto é só para a
       tela do Admin não mostrar como bloqueada uma conta que já não está */
    const [afetadas] = await db.Usuario.update(
      { bloqueado_ate: null, tentativas_login: 0 },
      { where: { bloqueado_ate: { [Op.lt]: new Date() } } }
    );

    return { afetadas };
  },
  { fila: FILAS.MANUTENCAO.nome }
);

module.exports = { LIMPAR_SESSOES, LIMPAR_TOKENS, DESBLOQUEAR_CONTAS };
