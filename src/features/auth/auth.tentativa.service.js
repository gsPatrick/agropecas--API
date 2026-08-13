'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const config = require('../../config');
const { erros } = require('../../utils/erros');
const { adicionarMinutos, segundosAte } = require('../../utils/datas');

/**
 * Defesa contra força bruta **na conta** (o rate-limit por IP é outra camada,
 * em `middlewares/rate-limit.js`).
 *
 * O bloqueio é por conta e não por IP porque no campo o cenário normal é uma
 * cidade inteira atrás do mesmo IP de operadora: bloquear IP tiraria clientes
 * legítimos do ar. Já bloquear a conta afeta apenas quem está sob ataque — e
 * o dono recupera com o fluxo de senha.
 */

const registrar = ({ usuarioId, email, sucesso, motivo, contexto }) =>
  db.TentativaLogin.create({
    usuario_id: usuarioId || null,
    email_tentado: email || null,
    sucesso: Boolean(sucesso),
    motivo_falha: sucesso ? null : motivo || null,
    ip_hash: contexto?.ipHash || null,
    user_agent: contexto?.userAgent || null,
  }).catch((erro) => console.error('[auth] falha ao registrar tentativa', erro.message));

/** lança 423 se a conta estiver em janela de bloqueio */
function garantirNaoBloqueado(usuario) {
  if (!usuario?.bloqueado_ate) return;
  if (new Date(usuario.bloqueado_ate) <= new Date()) return;

  const segundos = segundosAte(usuario.bloqueado_ate);
  throw erros.contaBloqueada(
    `Muitas tentativas. Tente novamente em ${Math.ceil(segundos / 60)} minuto(s).`,
    { segundosRestantes: segundos }
  );
}

/**
 * Falhas recentes desta conta, dentro da janela.
 *
 * Exportada para que o caminho de "conta inexistente" possa fazer a MESMA
 * consulta: o bcrypt de mentira equaliza o grosso do tempo, mas uma consulta a
 * menos ainda deixava diferença mensurável sob carga — e diferença de tempo é
 * enumeração de cadastro.
 */
function contarFalhasRecentes(usuarioId) {
  const desde = adicionarMinutos(-config.auth.janelaTentativasMinutos);

  return db.TentativaLogin.count({
    where: { usuario_id: usuarioId, sucesso: false, criado_em: { [Op.gte]: desde } },
  });
}

/**
 * Conta a falha. Ao estourar o limite dentro da janela, bloqueia.
 * @returns {{bloqueado: boolean, restantes: number}}
 */
async function contabilizarFalha(usuario) {
  if (!usuario) return { bloqueado: false, restantes: config.auth.maxTentativas };

  /* a janela evita punir quem errou 3 vezes hoje e 2 vezes no mês passado */
  const recentes = await contarFalhasRecentes(usuario.id);

  if (recentes >= config.auth.maxTentativas) {
    await usuario.update({
      tentativas_login: recentes,
      bloqueado_ate: adicionarMinutos(config.auth.bloqueioMinutos),
    });
    return { bloqueado: true, restantes: 0 };
  }

  await usuario.update({ tentativas_login: recentes });
  return { bloqueado: false, restantes: config.auth.maxTentativas - recentes };
}

/** login bem-sucedido zera o contador — senão o bloqueio viraria cumulativo */
const limpar = (usuario) =>
  usuario.update({ tentativas_login: 0, bloqueado_ate: null });

module.exports = {
  registrar,
  garantirNaoBloqueado,
  contabilizarFalha,
  contarFalhasRecentes,
  limpar,
};
