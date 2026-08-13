'use strict';

const jwt = require('jsonwebtoken');
const config = require('../../config');
const { erros } = require('../../utils/erros');

/**
 * Token de acesso (JWT curto) e refresh (token opaco, guardado em `sessoes`).
 *
 * O access token é curto de propósito: revogar JWT é impossível, então a
 * janela de dano de um token vazado é a validade dele. Quem revoga é o
 * refresh, que vive no banco e pode ser marcado.
 *
 * O payload carrega só o que o middleware precisa para buscar o usuário —
 * papéis e permissões NÃO entram: mudança de permissão precisa valer na hora,
 * não no próximo login.
 */

const ASSINATURA = {
  issuer: 'agropecas-api',
  audience: 'agropecas-web',
};

function gerarAcesso(usuario, { sessaoId } = {}) {
  return jwt.sign(
    { sub: usuario.id, email: usuario.email, sid: sessaoId || null, tipo: 'acesso' },
    config.seguranca.jwtSecret,
    { expiresIn: config.seguranca.jwtExpiresIn, ...ASSINATURA }
  );
}

function verificar(token) {
  try {
    return jwt.verify(token, config.seguranca.jwtSecret, ASSINATURA);
  } catch (erro) {
    if (erro.name === 'TokenExpiredError') {
      throw erros.naoAutenticado('Sessão expirada. Entre novamente.', 'TOKEN_EXPIRADO');
    }
    throw erros.naoAutenticado('Token inválido.', 'TOKEN_INVALIDO');
  }
}

/** lê sem validar assinatura — só para log e diagnóstico, nunca para autorizar */
const decodificar = (token) => jwt.decode(token);

module.exports = { gerarAcesso, verificar, decodificar };
