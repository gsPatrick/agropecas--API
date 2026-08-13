'use strict';

const { base } = require('../../cache/chaves');

/**
 * Chaves de cache da feature.
 *
 * Moram aqui, e não em `src/cache/chaves.js`, porque o padrão §7 manda a chave
 * nova nascer dentro da própria feature — módulos escritos em paralelo não
 * podem disputar o mesmo arquivo.
 *
 * As duas chaves deste módulo não guardam resposta: guardam **contador com
 * janela**. É o Redis fazendo o que o banco faria mal — uma linha de controle
 * por clique, escrita e lida a cada requisição, só para responder "já contei
 * este?" e "quantas vezes hoje?".
 *
 * Sem Redis o cache cai para memória e as duas janelas passam a valer por
 * processo. Para a janela do contador isso é aceitável (no pior caso alguns
 * contatos duplicados). Para o limite de revelação **não é** — está anotado em
 * `Contato.md` como pendência de infraestrutura, não de código.
 */

const prefixo = () => `${base()}:contato`;

const chaves = {
  /**
   * Janela anti-refresh do contador, por (anúncio × pessoa × canal).
   *
   * O canal entra na chave porque clicar no WhatsApp e depois abrir o chat são
   * duas intenções distintas do mesmo interessado, e o anunciante quer ver as
   * duas.
   */
  janela: (anuncioId, identidade, canal) => `${prefixo()}:janela:${anuncioId}:${canal}:${identidade}`,

  /** limite de revelações por pessoa — deliberadamente SEM o id do anúncio */
  revelacao: (identidade) => `${prefixo()}:revelacao:${identidade}`,

  dominio: () => `${prefixo()}*`,
};

/**
 * Quem é "a mesma pessoa" para efeito de janela e de limite.
 *
 * Usuário logado é identificado pela conta. Visitante cai no hash do IP — que
 * é pseudonimização, não identificação (LGPD), e é o melhor disponível.
 *
 * O prefixo (`u:` / `ip:`) evita a colisão improvável mas real entre um UUID e
 * um hash, e deixa o log de depuração legível.
 */
const identidade = (contexto) =>
  contexto?.usuarioId ? `u:${contexto.usuarioId}` : `ip:${contexto?.ipHash || 'desconhecido'}`;

module.exports = { chaves, identidade };
