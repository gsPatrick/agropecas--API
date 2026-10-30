'use strict';

const { REPASSE_STATUS } = require('./constantes');

/**
 * Repasse — o saldo do vendedor numa venda, guardado pela plataforma.
 *
 *   retido      pagamento aprovado, peça ainda não confirmada
 *   disponivel  recebimento confirmado: a Admin pode fazer o PIX
 *   pago        PIX feito e registrado
 *   cancelado   a venda foi reembolsada antes do PIX
 *
 * É o "ledger" da custódia: a soma dos `retido` + `disponivel` é exatamente
 * o que a conta Mercado Pago da plataforma deve aos vendedores.
 */
module.exports = (sequelize, DataTypes) => {
  const Repasse = sequelize.define(
    'Repasse',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      pedido_id: { type: DataTypes.UUID, allowNull: false, unique: true },
      vendedor_id: { type: DataTypes.UUID, allowNull: false },
      valor_centavos: { type: DataTypes.BIGINT, allowNull: false },
      status: { type: DataTypes.ENUM(...REPASSE_STATUS), allowNull: false, defaultValue: 'retido' },
      disponivel_em: { type: DataTypes.DATE, allowNull: true },
      chave_pix: { type: DataTypes.STRING(140), allowNull: true },
      chave_pix_tipo: { type: DataTypes.STRING(20), allowNull: true },
      pago_em: { type: DataTypes.DATE, allowNull: true },
      pago_por: { type: DataTypes.UUID, allowNull: true },
      comprovante: { type: DataTypes.STRING(255), allowNull: true },
      observacao: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'repasses',
      paranoid: false,
      indexes: [{ fields: ['vendedor_id', 'status'] }, { fields: ['status', 'disponivel_em'] }],
    }
  );

  Repasse.associate = (models) => {
    Repasse.belongsTo(models.Pedido, { foreignKey: 'pedido_id', as: 'pedido' });
    Repasse.belongsTo(models.Usuario, { foreignKey: 'vendedor_id', as: 'vendedor' });
  };

  return Repasse;
};
