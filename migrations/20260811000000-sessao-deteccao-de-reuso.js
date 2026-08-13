'use strict';

/**
 * Detecção de roubo de refresh token.
 *
 * O refresh rotaciona a cada renovação, então um token já rotacionado só é
 * reapresentado em um cenário: existem duas cópias em circulação — a legítima
 * e a roubada. Guardar o hash anterior permite reconhecer esse momento e
 * derrubar a sessão inteira, em vez de apenas recusar a requisição e deixar
 * quem roubou continuar renovando.
 *
 * Idempotente de propósito: o schema base é gerado a partir dos models, então
 * num banco criado do zero as colunas já nascem aqui. Esta migration existe
 * para os bancos que já rodavam antes da mudança.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const colunas = await queryInterface.describeTable('sessoes');
    if (colunas.token_anterior_hash) return; // banco novo: já veio do schema base

    await queryInterface.addColumn('sessoes', 'token_anterior_hash', {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: 'hash do refresh imediatamente anterior; usar de novo denuncia roubo',
    });

    await queryInterface.addColumn('sessoes', 'reutilizacao_detectada_em', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'momento em que um refresh já rotacionado foi reapresentado',
    });

    await queryInterface.addIndex('sessoes', ['token_anterior_hash'], {
      name: 'idx_sessoes_token_anterior_hash',
    });
  },

  async down(queryInterface) {
    const colunas = await queryInterface.describeTable('sessoes');
    if (!colunas.token_anterior_hash) return;

    await queryInterface.removeIndex('sessoes', 'idx_sessoes_token_anterior_hash');
    await queryInterface.removeColumn('sessoes', 'reutilizacao_detectada_em');
    await queryInterface.removeColumn('sessoes', 'token_anterior_hash');
  },
};
