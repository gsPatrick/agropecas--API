'use strict';

/**
 * PedidoHistorico — trilha imutável de cada mudança de estado do pedido.
 *
 * Em dinheiro de terceiro, "quem liberou este repasse e quando" não pode
 * depender de lembrança: é a resposta que a Admin dá ao vendedor que diz não
 * ter recebido, e ao comprador que diz não ter confirmado nada.
 */
module.exports = (sequelize, DataTypes) => {
  const PedidoHistorico = sequelize.define(
    'PedidoHistorico',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      pedido_id: { type: DataTypes.UUID, allowNull: false },
      status_anterior: { type: DataTypes.STRING(30), allowNull: true },
      status_novo: { type: DataTypes.STRING(30), allowNull: false },
      ator_id: { type: DataTypes.UUID, allowNull: true },
      ator_papel: { type: DataTypes.STRING(40), allowNull: true },
      motivo: { type: DataTypes.TEXT, allowNull: true },
      dados: { type: DataTypes.JSONB, allowNull: true },
    },
    {
      tableName: 'pedido_historico',
      paranoid: false,
      updatedAt: false,
      indexes: [{ fields: ['pedido_id', 'criado_em'] }],
    }
  );

  PedidoHistorico.associate = (models) => {
    PedidoHistorico.belongsTo(models.Pedido, { foreignKey: 'pedido_id', as: 'pedido' });
  };

  return PedidoHistorico;
};
