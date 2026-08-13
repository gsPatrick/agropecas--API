'use strict';

/**
 * Constantes da feature de conta.
 *
 * Ficam fora dos services para que prazo, lista de colunas e motivo de
 * revogação não precisem ser caçados em cinco arquivos no dia em que mudarem.
 */

/**
 * Colunas trazidas na LISTAGEM.
 *
 * Explícito de propósito: `observacoes_internas` é TEXT de uso do Admin e não
 * tem por que atravessar a rede em toda página de moderação, e `senha_hash`
 * nunca deve sair do banco. Lista branca aqui + lista branca no mapper —
 * quem esquecer um dos dois ainda não vaza.
 */
const CAMPOS_LISTA = [
  'id',
  'nome',
  'email',
  'telefone',
  'whatsapp',
  'status',
  'suspenso_ate',
  'email_verificado_em',
  'ultimo_login_em',
  'anonimizado_em',
  'criado_em',
];

/** na ficha individual o moderador precisa do porquê do status atual */
const CAMPOS_DETALHE = [
  ...CAMPOS_LISTA,
  'motivo_status',
  'idioma',
  'fuso_horario',
  'total_logins',
  'excluir_definitivamente_em',
  'atualizado_em',
];

/** campos que o titular pode alterar sozinho — o resto é moderação ou auth */
const CAMPOS_EDITAVEIS = ['nome', 'telefone', 'whatsapp', 'idioma', 'fuso_horario'];

/** motivos gravados em `sessoes.revogada_motivo` quando a conta muda de estado */
const MOTIVO_REVOGACAO = {
  SUSPENSAO: 'conta_suspensa',
  BANIMENTO: 'conta_banida',
  EXCLUSAO: 'conta_excluida',
};

/** rótulo do recurso em `logs_acesso_dado` — vocabulário fechado da LGPD */
const RECURSO_ACESSO = { CADASTRO: 'cadastro' };

/**
 * Status que impedem o titular de continuar usando a conta. Suspensão e
 * banimento derrubam sessão; `removido` também, porque a conta deixou de
 * existir para efeitos de uso.
 */
const STATUS_SEM_ACESSO = ['suspenso', 'banido', 'removido'];

module.exports = {
  CAMPOS_LISTA,
  CAMPOS_DETALHE,
  CAMPOS_EDITAVEIS,
  MOTIVO_REVOGACAO,
  RECURSO_ACESSO,
  STATUS_SEM_ACESSO,
};
