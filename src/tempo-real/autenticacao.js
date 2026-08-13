'use strict';

const jwtProvider = require('../providers/jwt');

/**
 * Aperto de mão do WebSocket.
 *
 * Mesma regra do HTTP: o token não basta, a **sessão precisa estar viva e ser
 * do usuário do token**. Sem isso, quem fizesse logout continuaria recebendo
 * mensagem em tempo real — o socket sobreviveria à sessão que o criou.
 *
 * Rejeitar aqui é barato; deixar entrar e filtrar depois é como cada `emit`
 * virar uma decisão de autorização.
 */
async function autenticarSocket(socket, seguir) {
  try {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers.authorization || '').replace('Bearer ', '');

    if (!token) return seguir(new Error('NAO_AUTENTICADO'));

    const payload = jwtProvider.verificar(token);
    if (!payload.sid) return seguir(new Error('SESSAO_INVALIDA'));

    const db = require('../models');

    const sessao = await db.Sessao.findByPk(payload.sid);
    if (!sessao || sessao.revogada_em) return seguir(new Error('SESSAO_REVOGADA'));
    if (String(sessao.usuario_id) !== String(payload.sub)) {
      return seguir(new Error('SESSAO_INVALIDA'));
    }

    const usuario = await db.Usuario.findByPk(payload.sub);
    if (!usuario || ['banido', 'suspenso', 'removido'].includes(usuario.status)) {
      return seguir(new Error('CONTA_INATIVA'));
    }

    socket.dados = { usuarioId: usuario.id, sessaoId: sessao.id, nome: usuario.nome };
    return seguir();
  } catch (erro) {
    return seguir(new Error('TOKEN_INVALIDO'));
  }
}

module.exports = { autenticarSocket };
