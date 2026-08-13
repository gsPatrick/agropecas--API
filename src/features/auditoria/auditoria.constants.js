'use strict';

const { AUDITORIA_ACAO } = require('../../models/constantes');

/**
 * Vocabulário da trilha. Fora dos services para que nenhum prazo ou nome de
 * recurso precise ser caçado em três arquivos no dia em que mudar.
 */

/** ações aceitas nos filtros — o enum do banco é a fonte, não uma cópia */
const ACOES = AUDITORIA_ACAO;

/**
 * Recursos que `logs_acesso_dado` conhece. É vocabulário fechado de propósito:
 * relatório de prestação de contas ao titular ("quem abriu o quê") só serve se
 * as strings forem comparáveis entre si — `cadastro`, `Cadastro` e
 * `dados_cadastrais` viram três coisas diferentes num agrupamento.
 */
const RECURSO_ACESSO = {
  CADASTRO: 'cadastro',
  DOCUMENTO: 'documento',
  CONVERSA: 'conversa',
  MENSAGEM: 'mensagem',
  ENDERECO_EXATO: 'endereco_exato',
  TELEFONE: 'telefone',
  EMAIL: 'email',
  SOLICITACAO_TITULAR: 'solicitacao_titular',
  EXPORTACAO: 'exportacao',
  TRILHA_AUDITORIA: 'trilha_auditoria',
};

const RECURSOS_ACESSO = Object.values(RECURSO_ACESSO);

/**
 * Teto da janela de consulta da trilha.
 *
 * `logs_auditoria` é a tabela que mais cresce no sistema e o índice útil é
 * `criado_em`. Sem período obrigatório, a primeira consulta do painel vira
 * varredura completa — e ela é feita justamente quando alguém está apurando um
 * incidente, ou seja, no pior momento possível para o banco ficar lento.
 */
const JANELA_PADRAO_DIAS = 30;
const JANELA_MAXIMA_DIAS = 366;

/** teto de página: exportação grande é trabalho da fila, não da rota */
const POR_PAGINA_MAXIMO = 100;

/** blocos do export — `findAll` sem limite carrega a tabela inteira na memória */
const BLOCO_EXPORTACAO = 1000;
const LIMITE_EXPORTACAO = 200000;

const FORMATO_EXPORTACAO = ['json', 'csv'];

/**
 * Parâmetros de filtragem por EXCLUSÃO que a API recusa explicitamente.
 *
 * Não é paranoia: uma trilha que o auditado consegue estreitar até sumir com
 * as próprias linhas não prova nada. Recusar com 422 (em vez de ignorar em
 * silêncio) deixa registrado que a tentativa foi feita — e o pedido inteiro
 * ainda passa por `registrarAcessoDado`.
 */
const FILTROS_PROIBIDOS = ['excluirAtor', 'excluirAtorId', 'atorIdDiferente', 'naoAtorId', 'ocultarAtor'];

module.exports = {
  ACOES,
  RECURSO_ACESSO,
  RECURSOS_ACESSO,
  JANELA_PADRAO_DIAS,
  JANELA_MAXIMA_DIAS,
  POR_PAGINA_MAXIMO,
  BLOCO_EXPORTACAO,
  LIMITE_EXPORTACAO,
  FORMATO_EXPORTACAO,
  FILTROS_PROIBIDOS,
};
