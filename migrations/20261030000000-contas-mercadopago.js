'use strict';

/**
 * Contas do Mercado Pago cadastradas pelo Admin.
 *
 * A cliente começa numa conta de pessoa física e vai migrar para CNPJ: as
 * credenciais deixam de viver só no `.env` e passam a ser trocáveis pelo
 * painel, com várias contas guardadas e UMA ativa por vez (índice parcial
 * garante a unicidade no banco, não só no código).
 *
 * `pedidos.conta_mp_id` grava com qual conta cada cobrança foi criada: o
 * pagamento de ontem só se consulta e só se estorna na conta que recebeu.
 *
 * Token e segredo do webhook ficam CIFRADOS (ver `utils/cifra.js`). A chave
 * da cifra mora no próprio banco (`segredos_sistema`), gerada sozinha no
 * primeiro uso — não há variável de ambiente para configurar.
 */

const carimbos = (Sequelize) => ({
  criado_em: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
  atualizado_em: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
});

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const tabelas = await queryInterface.showAllTables({ transaction });

      if (!tabelas.includes('segredos_sistema')) {
        await queryInterface.createTable(
          'segredos_sistema',
          {
            chave: { type: Sequelize.STRING(80), primaryKey: true },
            valor: { type: Sequelize.TEXT, allowNull: false },
            ...carimbos(Sequelize),
          },
          { transaction }
        );
      }

      if (!tabelas.includes('contas_mercadopago')) {
        await queryInterface.createTable(
          'contas_mercadopago',
          {
            id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
            apelido: { type: Sequelize.STRING(80), allowNull: false },
            tipo_pessoa: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'fisica' },
            modo: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'producao' },
            access_token: { type: Sequelize.TEXT, allowNull: false },
            public_key: { type: Sequelize.STRING(120), allowNull: true },
            webhook_secret: { type: Sequelize.TEXT, allowNull: true },
            ativa: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
            mp_user_id: { type: Sequelize.STRING(30), allowNull: true },
            mp_email: { type: Sequelize.STRING(160), allowNull: true },
            mp_nickname: { type: Sequelize.STRING(120), allowNull: true },
            verificada_em: { type: Sequelize.DATE, allowNull: true },
            ativada_em: { type: Sequelize.DATE, allowNull: true },
            ...carimbos(Sequelize),
          },
          { transaction }
        );
        await queryInterface.sequelize.query(
          'CREATE UNIQUE INDEX contas_mercadopago_uma_ativa ON contas_mercadopago (ativa) WHERE ativa = true;',
          { transaction }
        );
      }

      const colunas = await queryInterface.describeTable('pedidos', { transaction });
      if (!colunas.conta_mp_id) {
        await queryInterface.addColumn(
          'pedidos',
          'conta_mp_id',
          { type: Sequelize.UUID, allowNull: true, references: { model: 'contas_mercadopago', key: 'id' }, onDelete: 'SET NULL' },
          { transaction }
        );
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('pedidos', 'conta_mp_id', { transaction });
      await queryInterface.dropTable('contas_mercadopago', { transaction });
      await queryInterface.dropTable('segredos_sistema', { transaction });
    });
  },
};
