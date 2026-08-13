'use strict';

/**
 * Vocabulários e prazos da mesa de moderação.
 *
 * Fica fora dos services para que mudar "quantos dias dura uma suspensão
 * padrão" seja alterar um número aqui, e não caçar o valor em três arquivos.
 */

/** status de moderação que colocam o anúncio na fila (ENUM MODERACAO_STATUS) */
const FILA_STATUS = ['nao_revisado', 'em_analise'];

/** entidades em `logs_auditoria` — mesmo nome das tabelas */
const ENTIDADE = {
  ANUNCIO: 'anuncios',
  FOTO: 'anuncio_fotos',
  USUARIO: 'usuarios',
};

/** motivos gravados em `sessoes.revogada_motivo` quando a moderação derruba a conta */
const MOTIVO_REVOGACAO = {
  SUSPENSAO: 'conta_suspensa',
  BANIMENTO: 'conta_banida',
};

/**
 * Tamanho mínimo do motivo em ação punitiva.
 *
 * Não é burocracia: "ok" ou "." como justificativa de banimento é o mesmo que
 * não justificar, e é esse texto que o suporte lê quando a pessoa recorre.
 * Curto o bastante para não atrapalhar o moderador com pressa.
 */
const MOTIVO_MINIMO = 5;

/** limites da suspensão temporária, em dias */
const SUSPENSAO = { DIAS_PADRAO: 7, DIAS_MAXIMO: 365 };

/**
 * TTL do painel de contadores, em segundos.
 *
 * Trinta segundos, mesmo raciocínio da feature `configuracao`: são três
 * `COUNT(*)` que a tela dispara a cada abertura e a cada F5, e o número não
 * precisa ser exato ao segundo para orientar quem vai trabalhar na fila. A
 * invalidação explícita nas ações resolve o caso normal; o TTL é a rede de
 * segurança para quando o Redis estiver fora no instante da escrita.
 */
const TTL_PAINEL = 30;

/** rótulo do recurso em `logs_acesso_dado` ao abrir a ficha de um denunciado */
const RECURSO_ACESSO = 'ficha_moderacao';

module.exports = {
  FILA_STATUS,
  ENTIDADE,
  MOTIVO_REVOGACAO,
  MOTIVO_MINIMO,
  SUSPENSAO,
  TTL_PAINEL,
  RECURSO_ACESSO,
};
