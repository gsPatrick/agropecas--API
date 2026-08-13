'use strict';

/**
 * Constantes da feature.
 *
 * Aqui mora a fronteira entre o que é ajuste de PRODUTO (editável pela Admin
 * na tela, sem deploy) e o que é ambiente/infra (`src/config`, variável de
 * ambiente). Segredo, credencial e string de conexão NUNCA viram configuração:
 * a tabela é lida por rota pública em parte e por qualquer feature no resto —
 * um segredo aqui é um segredo com muitas portas.
 */

/** tipos aceitos pela coluna `tipo` do model */
const TIPO = {
  TEXTO: 'texto',
  NUMERO: 'numero',
  BOOLEANO: 'booleano',
  JSON: 'json',
  LISTA: 'lista',
};

const TIPOS = Object.values(TIPO);

/**
 * LISTA BRANCA da rota pública.
 *
 * A coluna `publica` do banco existe e é respeitada, mas **não é suficiente**:
 * ela é editável, e um UPDATE errado (ou um Admin curioso) transformaria
 * `chat.admin_le_somente_com_denuncia` em dado aberto. A rota pública só serve
 * chave que esteja NESTA lista **e** com `publica = true` — as duas condições.
 *
 * Nada de convenção por prefixo ("tudo que começa com publico." sai"): quem
 * cria a chave amanhã não vai lembrar da convenção, e o erro só aparece
 * quando o dado já vazou.
 */
const PUBLICAS = [
  'anuncio.max_fotos',
  'chat.ativo',
  'contato.whatsapp_suporte',
  'contato.email_suporte',
];

/**
 * TTL do cache, em segundos.
 *
 * Curto de propósito. A leitura é feita em quase toda requisição de outras
 * features, então cachear é obrigatório; mas a cliente pediu que o ajuste
 * "valha na hora". A invalidação explícita na escrita já resolve o caso normal
 * — o TTL é só a rede de segurança para o caso de a invalidação falhar (Redis
 * fora do ar no instante da escrita, por exemplo). Trinta segundos é o maior
 * atraso que aceitamos nesse cenário degradado.
 */
const TTL_SEGUNDOS = 30;

/**
 * Ação registrada em `logs_auditoria` a cada escrita.
 *
 * É `editar` e não `configuracao.alterada` porque a coluna `acao` é um ENUM do
 * Postgres com vocabulário fechado (`models/constantes.js` → AUDITORIA_ACAO), e
 * criar valor novo exigiria migration — que este módulo não pode escrever. A
 * combinação `acao=editar` + `entidade=configuracoes` já identifica a alteração
 * sem ambiguidade, e é assim que o histórico consulta.
 */
const ACAO_AUDITORIA = 'editar';

/** entidade em `logs_auditoria` — mesmo nome da tabela, como no resto do projeto */
const ENTIDADE = 'configuracoes';

module.exports = {
  TIPO,
  TIPOS,
  PUBLICAS,
  TTL_SEGUNDOS,
  ACAO_AUDITORIA,
  ENTIDADE,
};
