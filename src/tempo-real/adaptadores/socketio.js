'use strict';

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const config = require('../../config');
const redis = require('../../providers/redis');
const { autenticarSocket } = require('../autenticacao');
const { salas } = require('../salas');
const { ENTRADA, EVENTOS } = require('../eventos');

/**
 * Adaptador Socket.IO — único arquivo do projeto que conhece a biblioteca.
 * As features falam com `src/tempo-real`, nunca com isto.
 *
 * Com Redis, o adaptador de pub/sub faz um `emit` numa instância chegar a quem
 * está conectado em outra. Sem ele, dois processos = dois mundos, e metade dos
 * usuários não receberia a mensagem.
 */

let io = null;

async function iniciar(servidorHttp) {
  io = new Server(servidorHttp, {
    /* mesma regra do CORS do Express (`app.js`): CORS_ORIGENS=* precisa virar
       `true` (reflete a origem da requisição) — um array `['*']` não é
       reconhecido como coringa pelo pacote `cors` por baixo do Socket.IO, ele
       comparava literalmente a string "*" contra a origem e sempre recusava */
    cors: {
      origin: config.seguranca.corsOrigens.includes('*') ? true : config.seguranca.corsOrigens,
      credentials: true,
    },
    path: '/tempo-real',
    /* o cliente rural cai de rede o tempo todo: janela generosa de reconexão
       evita recriar sessão de socket a cada oscilação de sinal */
    pingTimeout: 30000,
    pingInterval: 25000,
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
  });

  if (config.redis.url) {
    const publicador = redis.novaConexao();
    const assinante = publicador.duplicate();
    io.adapter(createAdapter(publicador, assinante));
    console.log('[tempo-real] pub/sub via Redis (múltiplas instâncias)');
  } else {
    console.warn('[tempo-real] sem Redis: eventos não cruzam instâncias');
  }

  io.use(autenticarSocket);

  io.on('connection', (socket) => {
    const { usuarioId } = socket.dados;

    /* sala própria: é para onde vai tudo que é dele, sem o emissor precisar
       saber em quantos aparelhos ele está conectado */
    socket.join(salas.usuario(usuarioId));

    socket.on(ENTRADA.ENTRAR_CONVERSA, async (conversaId, responder) => {
      const permitido = await participaDaConversa(usuarioId, conversaId);

      /* a sala é decidida no SERVIDOR: aceitar o id que o cliente mandou sem
         conferir seria deixar qualquer um escutar conversa alheia */
      if (!permitido) return responder?.({ ok: false, erro: 'SEM_ACESSO' });

      socket.join(salas.conversa(conversaId));
      responder?.({ ok: true });
    });

    socket.on(ENTRADA.SAIR_CONVERSA, (conversaId) => {
      socket.leave(salas.conversa(conversaId));
    });

    socket.on(ENTRADA.DIGITANDO, (conversaId) => {
      /* só rebate para quem já está na sala — e a entrada na sala já foi
         autorizada, então não há checagem a repetir aqui */
      socket.to(salas.conversa(conversaId)).emit(EVENTOS.DIGITANDO, {
        conversaId,
        usuarioId,
      });
    });

    socket.on('disconnect', () => {
      /* nada a limpar: o Socket.IO remove das salas sozinho */
    });
  });

  console.log('[tempo-real] ativo em /tempo-real');
  return io;
}

/** consulta de acesso mora aqui e não no service para o socket não depender de feature */
async function participaDaConversa(usuarioId, conversaId) {
  if (!conversaId) return false;

  const db = require('../../models');
  const participante = await db.ConversaParticipante.findOne({
    where: { conversa_id: conversaId, usuario_id: usuarioId },
  });

  return Boolean(participante);
}

module.exports = {
  nome: 'socket.io',
  iniciar,

  paraUsuario(usuarioId, evento, dados) {
    io?.to(salas.usuario(usuarioId)).emit(evento, dados);
  },

  paraConversa(conversaId, evento, dados) {
    io?.to(salas.conversa(conversaId)).emit(evento, dados);
  },

  paraSala(sala, evento, dados) {
    io?.to(sala).emit(evento, dados);
  },

  async conectados(usuarioId) {
    if (!io) return 0;
    const sockets = await io.in(salas.usuario(usuarioId)).fetchSockets();
    return sockets.length;
  },

  async encerrar() {
    if (!io) return;
    await io.close();
    io = null;
  },
};
