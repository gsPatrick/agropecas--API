'use strict';

const { PEDIDO_STATUS } = require('./constantes');

/**
 * Pedido — uma compra de peça paga pelo Checkout Pro (Maturacao/06).
 *
 * Os valores são cópia do momento da compra, nunca lidos do anúncio depois:
 * o extrato do vendedor e o lucro da plataforma não podem mudar porque
 * alguém editou o preço do anúncio. `comissao + valor_vendedor = valor_total`
 * sempre — a conta é feita uma vez, em `pedido.calculo.js`.
 */
module.exports = (sequelize, DataTypes) => {
  const Pedido = sequelize.define(
    'Pedido',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      codigo: {
        type: DataTypes.STRING(16),
        allowNull: false,
        unique: true,
        comment: 'código curto (PED-7F3K9Q) — o que comprador e suporte falam ao telefone',
      },

      comprador_id: { type: DataTypes.UUID, allowNull: false },
      vendedor_id: { type: DataTypes.UUID, allowNull: false },
      anuncio_id: { type: DataTypes.UUID, allowNull: false },

      titulo: { type: DataTypes.STRING(160), allowNull: false },
      quantidade: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      preco_unitario_centavos: { type: DataTypes.BIGINT, allowNull: false },
      valor_total_centavos: { type: DataTypes.BIGINT, allowNull: false },
      comissao_percentual: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
      comissao_centavos: { type: DataTypes.BIGINT, allowNull: false },
      valor_vendedor_centavos: { type: DataTypes.BIGINT, allowNull: false },
      estoque_reservado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

      status: {
        type: DataTypes.ENUM(...PEDIDO_STATUS),
        allowNull: false,
        defaultValue: 'aguardando_pagamento',
      },

      /* conta do MP que recebeu a cobrança: consulta e estorno usam a mesma */
      conta_mp_id: { type: DataTypes.UUID, allowNull: true },
      mp_preferencia_id: { type: DataTypes.STRING(80), allowNull: true },
      mp_pagamento_id: { type: DataTypes.STRING(40), allowNull: true },
      mp_status: { type: DataTypes.STRING(30), allowNull: true },
      mp_status_detalhe: { type: DataTypes.STRING(80), allowNull: true },
      mp_metodo: { type: DataTypes.STRING(40), allowNull: true },
      checkout_url: { type: DataTypes.STRING(500), allowNull: true },

      reservado_ate: { type: DataTypes.DATE, allowNull: true },
      pago_em: { type: DataTypes.DATE, allowNull: true },
      liberacao_automatica_em: { type: DataTypes.DATE, allowNull: true },
      entregue_em: { type: DataTypes.DATE, allowNull: true },
      entrega_confirmada_por: {
        type: DataTypes.STRING(20),
        allowNull: true,
        comment: 'comprador | admin | sistema',
      },
      disputa_aberta_em: { type: DataTypes.DATE, allowNull: true },
      disputa_motivo: { type: DataTypes.TEXT, allowNull: true },
      cancelado_em: { type: DataTypes.DATE, allowNull: true },
      cancelamento_motivo: { type: DataTypes.TEXT, allowNull: true },
      reembolsado_em: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'pedidos',
      paranoid: false,
      indexes: [
        { fields: ['comprador_id', 'criado_em'] },
        { fields: ['vendedor_id', 'criado_em'] },
        { fields: ['anuncio_id'] },
        { fields: ['status', 'reservado_ate'] },
        { fields: ['status', 'liberacao_automatica_em'] },
        { fields: ['mp_pagamento_id'] },
      ],
    }
  );

  Pedido.associate = (models) => {
    Pedido.belongsTo(models.Usuario, { foreignKey: 'comprador_id', as: 'comprador' });
    Pedido.belongsTo(models.Usuario, { foreignKey: 'vendedor_id', as: 'vendedor' });
    Pedido.belongsTo(models.Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });
    Pedido.hasOne(models.Repasse, { foreignKey: 'pedido_id', as: 'repasse' });
    Pedido.hasMany(models.PedidoHistorico, { foreignKey: 'pedido_id', as: 'historico' });
  };

  return Pedido;
};
