'use strict';

const {
  TITULAR_SOLICITACAO_TIPO,
  TITULAR_SOLICITACAO_STATUS,
  DOCUMENTO_LEGAL_TIPO,
  CONSENTIMENTO_TIPO,
} = require('../../models/constantes');

/**
 * Vocabulário e prazos da conformidade. Fora dos services porque prazo legal
 * muda por decisão jurídica, não por refatoração — e quando mudar, precisa
 * mudar num lugar só.
 */

/**
 * Prazo de resposta ao titular.
 *
 * A LGPD tem dois prazos no art. 19: **imediato** para confirmação simples de
 * existência de tratamento, e **15 dias** para a declaração completa. Adotamos
 * 15 dias corridos para toda solicitação porque é o prazo que exige
 * organização — quem cumpre o de 15 cumpre o outro por consequência.
 *
 * Contado em dias CORRIDOS, não úteis: a lei não fala em dias úteis, e contar
 * úteis seria assumir uma interpretação mais folgada do que a literal.
 */
const PRAZO_RESPOSTA_DIAS = 15;

/** a partir daqui a solicitação aparece destacada para o encarregado */
const ALERTA_VENCIMENTO_DIAS = 3;

/** tipos que o titular pode abrir sozinho pela API */
const TIPOS_SOLICITACAO = TITULAR_SOLICITACAO_TIPO;
const STATUS_SOLICITACAO = TITULAR_SOLICITACAO_STATUS;

/** status que encerram o atendimento — não aceitam nova resposta */
const STATUS_FINAIS = ['concluida', 'recusada'];

const TIPOS_DOCUMENTO = DOCUMENTO_LEGAL_TIPO;
const TIPOS_CONSENTIMENTO = CONSENTIMENTO_TIPO;

/**
 * Documentos cujo desaceite trava o uso da plataforma. Marketing e cookies não
 * entram: recusá-los é direito do titular, e transformar recusa em bloqueio
 * seria consentimento forçado — o oposto do que o art. 8º §5º permite.
 */
const DOCUMENTOS_DE_ACEITE_OBRIGATORIO = ['termos_de_uso', 'politica_privacidade'];

/**
 * Documentos cujo aceite é RASTREÁVEL na tabela de consentimentos.
 *
 * Os dois enums não coincidem: `DOCUMENTO_LEGAL_TIPO` tem `politica_cookies`,
 * `CONSENTIMENTO_TIPO` não — lá o assunto aparece granular
 * (`cookies_analiticos`). Consultar `consentimentos` com `tipo =
 * 'politica_cookies'` faz o Postgres recusar o valor do enum e derrubar a
 * requisição inteira com 500, e era exatamente o que acontecia em
 * `GET /admin/lgpd/documentos` e em `GET /lgpd/consentimentos/pendencias`.
 *
 * Derivado da interseção, e não escrito à mão: uma lista fixa divergiria no
 * dia em que um dos dois enums ganhasse um valor novo, e o erro voltaria pela
 * mesma porta. Corrigir os enums exigiria migration — arquivo proibido a este
 * módulo —, e a interseção já é a verdade que as consultas precisam respeitar.
 */
const TIPOS_DOCUMENTO_COM_CONSENTIMENTO = TIPOS_DOCUMENTO.filter((tipo) =>
  TIPOS_CONSENTIMENTO.includes(tipo)
);

/**
 * Validade do link de download do export.
 *
 * Curto de propósito: o pacote contém TUDO sobre uma pessoa. Trinta minutos é
 * o suficiente para quem pediu clicar no e-mail, e curto demais para um link
 * esquecido numa caixa de entrada invadida meses depois virar vazamento.
 */
const LINK_MINUTOS = 30;

/**
 * Tipo de token usado na confirmação de exportação.
 *
 * ⚠️ `TOKEN_TIPO` (models/constantes.js) não tem um valor próprio para
 * confirmação de ação sensível, e o enum é do banco — criar um exigiria
 * migration, que este módulo não pode escrever. Reaproveitar `otp_login` tem
 * um efeito colateral conhecido e reportado: `emitir` invalida os códigos
 * anteriores do mesmo tipo, então pedir exportação invalida um OTP de login
 * pendente. Ver "Lacunas" em `documentacao/features/Lgpd.md`.
 */
const TOKEN_CONFIRMACAO = 'otp_login';
const TOKEN_CONFIRMACAO_MINUTOS = 15;

/** frase que o titular precisa digitar para anonimizar — ação irreversível */
const CONFIRMACAO_ANONIMIZACAO = 'ANONIMIZAR MINHA CONTA';

/**
 * Marcadores que substituem o dado identificável.
 *
 * Substituir por marcador e não por `null`: campo vazio parece bug de
 * migração, e a próxima pessoa que abrir a tabela "conserta" preenchendo de
 * volta a partir de algum backup. O marcador declara que a ausência foi
 * decidida.
 */
const MARCADOR = {
  NOME: 'Usuário removido',
  PERFIL: 'Perfil removido',
  EMAIL: (id) => `anonimizado+${id}@removido.invalido`,
  SLUG: (id) => `usuario-removido-${String(id).slice(0, 8)}`,
  /* só troca o CONTEÚDO que a própria pessoa escreveu — mensagem do outro
     lado da conversa, ou denúncia feita POR outra pessoa CONTRA quem saiu,
     não são dado do titular que está pedindo a remoção */
  MENSAGEM: '[mensagem removida — conta anonimizada]',
};

/** blocos do export — a conta de um lojista antigo não cabe confortável em memória */
const BLOCO_EXPORTACAO = 500;

module.exports = {
  PRAZO_RESPOSTA_DIAS,
  ALERTA_VENCIMENTO_DIAS,
  TIPOS_SOLICITACAO,
  STATUS_SOLICITACAO,
  STATUS_FINAIS,
  TIPOS_DOCUMENTO,
  TIPOS_CONSENTIMENTO,
  DOCUMENTOS_DE_ACEITE_OBRIGATORIO,
  TIPOS_DOCUMENTO_COM_CONSENTIMENTO,
  LINK_MINUTOS,
  TOKEN_CONFIRMACAO,
  TOKEN_CONFIRMACAO_MINUTOS,
  CONFIRMACAO_ANONIMIZACAO,
  MARCADOR,
  BLOCO_EXPORTACAO,
};
