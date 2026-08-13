'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const config = require('../../config');
const jwtProvider = require('../../providers/jwt');
const { erros } = require('../../utils/erros');
const { gerarToken, hashToken } = require('../../utils/hash');
const { duracaoParaMs } = require('../../utils/datas');
const { MOTIVO_REVOGACAO } = require('./auth.constants');

/**
 * Ciclo de vida da sessão: abrir, renovar, encerrar, listar.
 *
 * Duas peças com papéis distintos:
 *   - access token (JWT, ~15min) — não é revogável, por isso é curto;
 *   - refresh token (opaco, no banco) — é o que dá para revogar de verdade.
 *
 * O refresh é guardado em hash: vazamento da tabela `sessoes` não vira
 * sequestro de conta.
 */

/** rótulo humano do aparelho, para a tela "meus dispositivos" */
function descreverDispositivo(userAgent = '') {
  const ua = userAgent.toLowerCase();
  const sistema =
    (ua.includes('android') && 'Android') ||
    ((ua.includes('iphone') || ua.includes('ipad')) && 'iOS') ||
    (ua.includes('windows') && 'Windows') ||
    (ua.includes('mac os') && 'macOS') ||
    (ua.includes('linux') && 'Linux') ||
    'Desconhecido';

  const navegador =
    (ua.includes('edg/') && 'Edge') ||
    (ua.includes('chrome') && 'Chrome') ||
    (ua.includes('firefox') && 'Firefox') ||
    (ua.includes('safari') && 'Safari') ||
    'Navegador';

  return `${navegador} · ${sistema}`;
}

async function abrir(usuario, contexto) {
  const refresh = gerarToken();
  const expiraEm = new Date(Date.now() + duracaoParaMs(config.seguranca.jwtRefreshExpiresIn));

  const sessao = await db.Sessao.create({
    usuario_id: usuario.id,
    token_hash: hashToken(refresh),
    dispositivo: descreverDispositivo(contexto?.userAgent),
    user_agent: contexto?.userAgent || null,
    ip_hash: contexto?.ipHash || null,
    plataforma: contexto?.origem || 'web',
    ultima_atividade_em: new Date(),
    expira_em: expiraEm,
  });

  await aparar(usuario.id);

  return {
    sessao,
    tokens: {
      acesso: jwtProvider.gerarAcesso(usuario, { sessaoId: sessao.id }),
      refresh,
      expiraEm: config.seguranca.jwtExpiresIn,
    },
  };
}

/**
 * Mantém o teto de sessões ativas revogando as mais antigas.
 * Sem teto, uma conta comprometida acumula acessos permanentes sem que o dono
 * perceba nada na tela de dispositivos.
 */
async function aparar(usuarioId) {
  const ativas = await db.Sessao.findAll({
    where: { usuario_id: usuarioId, revogada_em: null },
    order: [['criado_em', 'DESC']],
  });

  const excedentes = ativas.slice(config.auth.maxSessoesPorUsuario);
  if (!excedentes.length) return 0;

  await db.Sessao.update(
    { revogada_em: new Date(), revogada_motivo: MOTIVO_REVOGACAO.LIMITE_SESSOES },
    { where: { id: excedentes.map((sessao) => sessao.id) } }
  );
  return excedentes.length;
}

/**
 * Troca o refresh por um par novo — rotação a cada uso.
 * Rotacionar transforma reuso de token roubado em algo detectável: o token
 * antigo deixa de existir no mesmo instante.
 */
async function renovar(refresh, contexto) {
  if (!refresh) throw erros.naoAutenticado('Token de renovação ausente.', 'REFRESH_AUSENTE');

  const hash = hashToken(refresh);

  const sessao = await db.Sessao.findOne({
    where: { token_hash: hash, revogada_em: null, expira_em: { [Op.gt]: new Date() } },
  });

  if (!sessao) {
    /* o token não vale mais. Antes de recusar, checar se ele é o ANTERIOR de
       alguma sessão: como a rotação é a cada uso, ninguém legítimo reapresenta
       o token velho. Se isso acontece, há duas cópias circulando — e recusar
       só esta requisição deixaria quem roubou seguir renovando com a cópia
       boa. A sessão inteira cai. */
    const reutilizada = await db.Sessao.findOne({ where: { token_anterior_hash: hash } });

    if (reutilizada && !reutilizada.revogada_em) {
      await reutilizada.update({
        revogada_em: new Date(),
        revogada_motivo: MOTIVO_REVOGACAO.REUSO_DETECTADO,
        reutilizacao_detectada_em: new Date(),
      });
      console.warn('[auth] reuso de refresh detectado — sessão derrubada', {
        sessaoId: reutilizada.id,
        usuarioId: reutilizada.usuario_id,
      });
    }

    throw erros.naoAutenticado('Sessão inválida ou expirada.', 'REFRESH_INVALIDO');
  }

  const usuario = await db.Usuario.findByPk(sessao.usuario_id);
  if (!usuario || ['banido', 'suspenso', 'removido'].includes(usuario.status)) {
    await sessao.update({ revogada_em: new Date(), revogada_motivo: MOTIVO_REVOGACAO.ADMIN });
    throw erros.contaBloqueada('Esta conta não está ativa.');
  }

  const novo = gerarToken();
  await sessao.update({
    token_hash: hashToken(novo),
    token_anterior_hash: hash,
    ultima_atividade_em: new Date(),
    ip_hash: contexto?.ipHash || sessao.ip_hash,
  });

  return {
    usuario,
    sessao,
    tokens: {
      acesso: jwtProvider.gerarAcesso(usuario, { sessaoId: sessao.id }),
      refresh: novo,
      expiraEm: config.seguranca.jwtExpiresIn,
    },
  };
}

async function encerrar(sessaoId, motivo = MOTIVO_REVOGACAO.LOGOUT) {
  if (!sessaoId) return false;
  const [afetadas] = await db.Sessao.update(
    { revogada_em: new Date(), revogada_motivo: motivo },
    { where: { id: sessaoId, revogada_em: null } }
  );
  return afetadas > 0;
}

/** encerra todas; `exceto` preserva a sessão atual em "sair dos outros aparelhos" */
async function encerrarTodas(usuarioId, { exceto, motivo = MOTIVO_REVOGACAO.LOGOUT_TODOS } = {}) {
  const where = { usuario_id: usuarioId, revogada_em: null };
  if (exceto) where.id = { [Op.ne]: exceto };

  const [afetadas] = await db.Sessao.update(
    { revogada_em: new Date(), revogada_motivo: motivo },
    { where }
  );
  return afetadas;
}

const listar = (usuarioId) =>
  db.Sessao.findAll({
    where: { usuario_id: usuarioId, revogada_em: null, expira_em: { [Op.gt]: new Date() } },
    order: [['ultima_atividade_em', 'DESC']],
  });

/** heartbeat barato para a tela de dispositivos não mentir sobre "ativo agora" */
const tocar = (sessaoId) =>
  sessaoId
    ? db.Sessao.update({ ultima_atividade_em: new Date() }, { where: { id: sessaoId } })
    : Promise.resolve();

module.exports = { abrir, renovar, encerrar, encerrarTodas, listar, tocar, descreverDispositivo };
