'use strict';

/**
 * Compra com custódia (Maturacao/06): pedidos, histórico de pedido, repasses
 * ao vendedor e a chave PIX no perfil.
 *
 * Dinheiro em centavos (BIGINT), como `anuncios.preco_centavos`: decimal em
 * float perde centavo no arredondamento da comissão, e é justamente a
 * comissão que ninguém pode errar.
 *
 * Valores do pedido são CÓPIA do momento da compra (preço, comissão, título):
 * o vendedor pode mudar o anúncio amanhã, e o extrato de ontem não pode
 * mudar junto.
 *
 * Numa transação, como as demais: o boot roda `db:migrate` sozinho e um
 * deploy interrompido no meio não pode deixar metade das tabelas criada.
 */

const PEDIDO_STATUS = [
  'aguardando_pagamento',
  'pago',
  'em_disputa',
  'entregue',
  'concluido',
  'cancelado',
  'reembolsado',
];
const REPASSE_STATUS = ['retido', 'disponivel', 'pago', 'cancelado'];
const CHAVE_PIX_TIPO = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'];

const carimbos = (Sequelize) => ({
  criado_em: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
  atualizado_em: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
});

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const tabelas = await queryInterface.showAllTables({ transaction });

      if (!tabelas.includes('pedidos')) {
        await queryInterface.createTable(
          'pedidos',
          {
            id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
            codigo: { type: Sequelize.STRING(16), allowNull: false, unique: true },

            comprador_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'usuarios', key: 'id' } },
            vendedor_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'usuarios', key: 'id' } },
            anuncio_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'anuncios', key: 'id' } },

            titulo: { type: Sequelize.STRING(160), allowNull: false },
            quantidade: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
            preco_unitario_centavos: { type: Sequelize.BIGINT, allowNull: false },
            valor_total_centavos: { type: Sequelize.BIGINT, allowNull: false },
            comissao_percentual: { type: Sequelize.DECIMAL(5, 2), allowNull: false },
            comissao_centavos: { type: Sequelize.BIGINT, allowNull: false },
            valor_vendedor_centavos: { type: Sequelize.BIGINT, allowNull: false },
            /* a reserva só devolve estoque se tirou estoque — anúncio sem
               quantidade controlada (`null`) não mexe em nada */
            estoque_reservado: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },

            status: { type: Sequelize.ENUM(...PEDIDO_STATUS), allowNull: false, defaultValue: 'aguardando_pagamento' },

            mp_preferencia_id: { type: Sequelize.STRING(80), allowNull: true },
            mp_pagamento_id: { type: Sequelize.STRING(40), allowNull: true },
            mp_status: { type: Sequelize.STRING(30), allowNull: true },
            mp_status_detalhe: { type: Sequelize.STRING(80), allowNull: true },
            mp_metodo: { type: Sequelize.STRING(40), allowNull: true },
            checkout_url: { type: Sequelize.STRING(500), allowNull: true },

            reservado_ate: { type: Sequelize.DATE, allowNull: true },
            pago_em: { type: Sequelize.DATE, allowNull: true },
            liberacao_automatica_em: { type: Sequelize.DATE, allowNull: true },
            entregue_em: { type: Sequelize.DATE, allowNull: true },
            entrega_confirmada_por: { type: Sequelize.STRING(20), allowNull: true },
            disputa_aberta_em: { type: Sequelize.DATE, allowNull: true },
            disputa_motivo: { type: Sequelize.TEXT, allowNull: true },
            cancelado_em: { type: Sequelize.DATE, allowNull: true },
            cancelamento_motivo: { type: Sequelize.TEXT, allowNull: true },
            reembolsado_em: { type: Sequelize.DATE, allowNull: true },

            ...carimbos(Sequelize),
          },
          { transaction }
        );

        await queryInterface.addIndex('pedidos', ['comprador_id', 'criado_em'], { transaction });
        await queryInterface.addIndex('pedidos', ['vendedor_id', 'criado_em'], { transaction });
        await queryInterface.addIndex('pedidos', ['anuncio_id'], { transaction });
        await queryInterface.addIndex('pedidos', ['status', 'reservado_ate'], { transaction });
        await queryInterface.addIndex('pedidos', ['status', 'liberacao_automatica_em'], { transaction });
        /* o webhook acha o pedido pelo id do pagamento quando a notificação
           não traz `external_reference` (reembolso aberto pelo painel do MP) */
        await queryInterface.addIndex('pedidos', ['mp_pagamento_id'], { transaction });
      }

      if (!tabelas.includes('pedido_historico')) {
        await queryInterface.createTable(
          'pedido_historico',
          {
            id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
            pedido_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'pedidos', key: 'id' }, onDelete: 'CASCADE' },
            status_anterior: { type: Sequelize.STRING(30), allowNull: true },
            status_novo: { type: Sequelize.STRING(30), allowNull: false },
            ator_id: { type: Sequelize.UUID, allowNull: true },
            ator_papel: { type: Sequelize.STRING(40), allowNull: true },
            motivo: { type: Sequelize.TEXT, allowNull: true },
            dados: { type: Sequelize.JSONB, allowNull: true },
            criado_em: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
          },
          { transaction }
        );
        await queryInterface.addIndex('pedido_historico', ['pedido_id', 'criado_em'], { transaction });
      }

      if (!tabelas.includes('repasses')) {
        await queryInterface.createTable(
          'repasses',
          {
            id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
            /* um repasse por pedido — o índice único é o que garante que o
               webhook repetido não cria dois saldos para a mesma venda */
            pedido_id: { type: Sequelize.UUID, allowNull: false, unique: true, references: { model: 'pedidos', key: 'id' } },
            vendedor_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'usuarios', key: 'id' } },
            valor_centavos: { type: Sequelize.BIGINT, allowNull: false },
            status: { type: Sequelize.ENUM(...REPASSE_STATUS), allowNull: false, defaultValue: 'retido' },
            disponivel_em: { type: Sequelize.DATE, allowNull: true },
            /* cópia da chave no momento do pagamento: se o vendedor trocar
               depois, o comprovante continua dizendo para onde foi */
            chave_pix: { type: Sequelize.STRING(140), allowNull: true },
            chave_pix_tipo: { type: Sequelize.STRING(20), allowNull: true },
            pago_em: { type: Sequelize.DATE, allowNull: true },
            pago_por: { type: Sequelize.UUID, allowNull: true },
            comprovante: { type: Sequelize.STRING(255), allowNull: true },
            observacao: { type: Sequelize.TEXT, allowNull: true },
            ...carimbos(Sequelize),
          },
          { transaction }
        );
        await queryInterface.addIndex('repasses', ['vendedor_id', 'status'], { transaction });
        await queryInterface.addIndex('repasses', ['status', 'disponivel_em'], { transaction });
      }

      const colunas = await queryInterface.describeTable('perfis', { transaction });
      if (!colunas.chave_pix) {
        await queryInterface.addColumn('perfis', 'chave_pix', { type: Sequelize.STRING(140), allowNull: true }, { transaction });
      }
      if (!colunas.chave_pix_tipo) {
        await queryInterface.addColumn(
          'perfis',
          'chave_pix_tipo',
          { type: Sequelize.ENUM(...CHAVE_PIX_TIPO), allowNull: true },
          { transaction }
        );
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('perfis', 'chave_pix_tipo', { transaction });
      await queryInterface.removeColumn('perfis', 'chave_pix', { transaction });
      await queryInterface.dropTable('repasses', { transaction });
      await queryInterface.dropTable('pedido_historico', { transaction });
      await queryInterface.dropTable('pedidos', { transaction });
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_repasses_status";', { transaction });
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_pedidos_status";', { transaction });
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_perfis_chave_pix_tipo";', { transaction });
    });
  },
};
