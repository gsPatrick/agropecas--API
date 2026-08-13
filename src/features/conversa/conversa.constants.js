'use strict';

/**
 * Constantes da feature. Ficam fora dos services para que nenhum número
 * mágico precise ser caçado em cinco arquivos quando a cliente pedir uma
 * mensagem mais longa ou um limite de envio diferente.
 */

/** teto de caracteres de uma mensagem de texto.
 *  2000 é o que cabe numa conversa de negociação de peça sem virar canal de
 *  publicação: quem precisa de mais está usando o chat como e-mail, e um TEXT
 *  sem teto é convite para encher a tabela mais quente do sistema. */
const CONTEUDO_MAXIMO = 2000;

/** a prévia mora na coluna `conversas.ultima_mensagem_previa`, STRING(160) —
 *  o corte precisa acontecer aqui, senão o banco recusa a linha */
const PREVIA_MAXIMA = 160;

/** paginação por cursor das mensagens */
const MENSAGENS_POR_PAGINA = 30;
const MENSAGENS_POR_PAGINA_MAXIMO = 100;

/**
 * Limite de envio.
 *
 * Não é o rate-limit genérico de escrita (30/min por IP): no interior de MT a
 * região inteira sai pelo mesmo IP de operadora, então contar por IP puniria
 * uma cidade por causa de um spammer. Aqui a contagem é por CONTA.
 */
const LIMITE_ENVIO = { max: 30, janelaMs: 60 * 1000 };

/** iniciar conversa é mais caro que responder: cada início cria linha nova e
 *  toca um usuário que não pediu contato */
const LIMITE_INICIO = { max: 10, janelaMs: 60 * 1000 };

/**
 * Ações gravadas em `logs_auditoria`.
 *
 * `logs_auditoria.acao` é um ENUM do banco com VERBOS genéricos (criar,
 * editar, remover…) — quem diz sobre o quê é a coluna `entidade`. Estes
 * apelidos existem para que os services falem no vocabulário do chat sem que
 * cada um precise lembrar do verbo certo; um valor fora do enum é rejeitado
 * pelo Postgres e a auditoria se perde em silêncio.
 */
const ACAO = {
  MENSAGEM_REMOVIDA: 'remover',
  USUARIO_BLOQUEADO: 'criar',
  USUARIO_DESBLOQUEADO: 'remover',
  CONVERSA_ENCERRADA: 'editar',
};

/** texto que substitui o conteúdo de uma mensagem removida.
 *  O registro fica (moderação precisa dele); o conteúdo sai da tela. */
const CONTEUDO_REMOVIDO = 'Mensagem removida.';

/** status de anúncio que ainda aceitam contato. Anúncio removido/expirado não
 *  inicia conversa nova — mas as já existentes continuam abertas, porque a
 *  negociação costuma seguir depois do anúncio sair do ar. */
const ANUNCIO_CONTATAVEL = ['publicado', 'pausado'];

module.exports = {
  CONTEUDO_MAXIMO,
  PREVIA_MAXIMA,
  MENSAGENS_POR_PAGINA,
  MENSAGENS_POR_PAGINA_MAXIMO,
  LIMITE_ENVIO,
  LIMITE_INICIO,
  ACAO,
  CONTEUDO_REMOVIDO,
  ANUNCIO_CONTATAVEL,
};
