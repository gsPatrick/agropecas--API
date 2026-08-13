'use strict';

/**
 * Constantes da feature. Ficam fora dos services para que nenhuma string
 * mágica precise ser caçada em três arquivos quando um prazo mudar.
 */

/** motivos de falha gravados em `tentativas_login` — vocabulário fechado */
const MOTIVO_FALHA = {
  USUARIO_INEXISTENTE: 'usuario_inexistente',
  SENHA_INCORRETA: 'senha_incorreta',
  CONTA_BLOQUEADA: 'conta_bloqueada',
  CONTA_SUSPENSA: 'conta_suspensa',
  CONTA_BANIDA: 'conta_banida',
  EMAIL_NAO_VERIFICADO: 'email_nao_verificado',
};

/** motivos de revogação de sessão */
const MOTIVO_REVOGACAO = {
  LOGOUT: 'logout',
  LOGOUT_TODOS: 'logout_todos_dispositivos',
  TROCA_SENHA: 'senha_alterada',
  RECUPERACAO_SENHA: 'senha_recuperada',
  LIMITE_SESSOES: 'limite_de_sessoes_excedido',
  ADMIN: 'encerrada_pelo_admin',
  REUSO_DETECTADO: 'reuso_de_refresh_detectado',
};

/** consentimentos que o cadastro exige — LGPD art. 8º */
const CONSENTIMENTOS_OBRIGATORIOS = ['termos_de_uso', 'politica_privacidade'];

/** consentimentos opcionais que o formulário de cadastro pode enviar */
const CONSENTIMENTOS_OPCIONAIS = ['exibir_whatsapp', 'comunicacao_marketing'];

module.exports = {
  MOTIVO_FALHA,
  MOTIVO_REVOGACAO,
  CONSENTIMENTOS_OBRIGATORIOS,
  CONSENTIMENTOS_OPCIONAIS,
};
