'use strict';

/**
 * Valores de enum que os módulos precisaram e não existiam.
 *
 * A falta era silenciosa e por isso perigosa: `logs_auditoria.acao` é ENUM no
 * Postgres, e gravar um verbo inexistente faz o INSERT falhar — mas a
 * auditoria é deliberadamente tolerante a falha (um log perdido não pode
 * derrubar a operação do usuário). Resultado: a ação acontecia e o rastro
 * sumia, sem ninguém perceber. Três agentes esbarraram nisso de formas
 * diferentes.
 *
 * `ADD VALUE IF NOT EXISTS` é idempotente e não reescreve a tabela.
 */

const NOVOS = {
  enum_logs_auditoria_acao: [
    'anonimizar',        // LGPD: anonimização de conta, que não é "remover"
    'consultar',         // leitura registrada (trilha, ficha de titular)
    'configurar',        // alteração de configuração do sistema
    'enviar_comunicado', // disparo de notificação em massa
    'moderar',           // decisão de moderação sobre conteúdo
  ],
  enum_notificacoes_tipo: [
    'contato_recebido',   // alguém pediu o WhatsApp do anunciante
    'anuncio_moderado',
    'denuncia_recebida',
    'conta_reativada',
    'documento_atualizado', // nova versão dos Termos exige reaceite
  ],
  enum_tokens_verificacao_tipo: [
    /* confirmação de exportação de dados. Antes reusava `otp_login`, o que
       invalidava um OTP de login pendente do mesmo usuário */
    'confirmacao_exportacao',
    'confirmacao_exclusao',
  ],
};

module.exports = {
  async up(queryInterface) {
    for (const [tipo, valores] of Object.entries(NOVOS)) {
      for (const valor of valores) {
        await queryInterface.sequelize.query(
          `ALTER TYPE ${tipo} ADD VALUE IF NOT EXISTS '${valor}';`
        );
      }
    }
  },

  async down() {
    /* o Postgres não remove valor de enum sem recriar o tipo e reescrever
       todas as colunas que o usam. Reverter aqui destruiria dado gravado com
       esses valores — o custo de manter um rótulo a mais é zero */
  },
};
