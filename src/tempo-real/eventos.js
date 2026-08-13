'use strict';

/**
 * Catálogo de eventos do tempo real.
 *
 * O front escuta estas strings. Trocar uma sem avisar quebra a tela sem
 * quebrar nenhum teste de servidor — por isso vocabulário fechado, do mesmo
 * jeito que as permissões do RBAC.
 *
 * Convenção `dominio:acontecimento`, sempre no passado: o evento relata o que
 * já ocorreu, não pede ação.
 */

const EVENTOS = {
  // ── conversa
  MENSAGEM_NOVA: 'mensagem:nova',
  MENSAGEM_LIDA: 'mensagem:lida',
  CONVERSA_ATUALIZADA: 'conversa:atualizada',
  DIGITANDO: 'conversa:digitando',

  // ── notificação
  NOTIFICACAO_NOVA: 'notificacao:nova',
  NOTIFICACAO_LIDA: 'notificacao:lida',
  CONTADOR_ATUALIZADO: 'contador:atualizado',

  // ── anúncio
  ANUNCIO_MODERADO: 'anuncio:moderado',
  ANUNCIO_VISUALIZADO: 'anuncio:visualizado',
  ANUNCIO_CONTATO: 'anuncio:contato',

  // ── moderação (painel)
  DENUNCIA_NOVA: 'denuncia:nova',
  MODERACAO_PENDENTE: 'moderacao:pendente',

  // ── conta
  SESSAO_ENCERRADA: 'sessao:encerrada',
  CONTA_ATUALIZADA: 'conta:atualizada',
};

/** eventos que o CLIENTE pode emitir — o resto é ignorado */
const ENTRADA = {
  ENTRAR_CONVERSA: 'conversa:entrar',
  SAIR_CONVERSA: 'conversa:sair',
  DIGITANDO: 'conversa:digitando',
  MARCAR_LIDA: 'conversa:marcar-lida',
};

module.exports = { EVENTOS, ENTRADA };
