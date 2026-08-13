'use strict';

/**
 * UsoMedido — contador de consumo por chave e período.
 * Existe para que a checagem de quota não precise varrer a tabela de anúncios
 * a cada publicação quando os planos entrarem.
 */
module.exports = (sequelize, DataTypes) => {
  const UsoMedido = sequelize.define(
    'UsoMedido',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: false },
      chave: { type: DataTypes.STRING(60), allowNull: false },
      periodo_inicio: { type: DataTypes.DATEONLY, allowNull: false },
      periodo_fim: { type: DataTypes.DATEONLY, allowNull: true },
      quantidade: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'usos_medidos',
      paranoid: false,
      indexes: [{ unique: true, fields: ['usuario_id', 'chave', 'periodo_inicio'] }],
    }
  );

  UsoMedido.associate = (models) => {
    UsoMedido.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
  };

  return UsoMedido;
};
