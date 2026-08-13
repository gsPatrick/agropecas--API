'use strict';

/**
 * Nomes de sala em um lugar só.
 *
 * Sala é o endereçamento do tempo real: emitir para a sala errada é vazar
 * mensagem privada para quem não devia ver. Centralizar garante que quem
 * entra e quem emite usem exatamente a mesma string.
 */

const salas = {
  /** tudo que é do usuário — notificação, contador, aviso de moderação */
  usuario: (id) => `usuario:${id}`,

  /** uma conversa específica; só os dois participantes entram */
  conversa: (id) => `conversa:${id}`,

  /** dono do anúncio recebe evento de visualização e contato */
  anuncio: (id) => `anuncio:${id}`,

  /** painel administrativo: fila de moderação e denúncias em tempo real */
  moderacao: () => 'moderacao',
};

module.exports = { salas };
