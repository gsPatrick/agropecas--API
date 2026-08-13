'use strict';

/** BloqueioUsuario — usuário bloqueia outro; encerra conversas e esconde anúncios. */
module.exports = (sequelize, DataTypes) => {
  const BloqueioUsuario = sequelize.define(
    'BloqueioUsuario',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: false },
      bloqueado_id: { type: DataTypes.UUID, allowNull: false },
      motivo: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: 'bloqueios_usuario',
      paranoid: false,
      updatedAt: false,
      indexes: [{ unique: true, fields: ['usuario_id', 'bloqueado_id'] }],
    }
  );

  BloqueioUsuario.associate = (models) => {
    BloqueioUsuario.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
    BloqueioUsuario.belongsTo(models.Usuario, { foreignKey: 'bloqueado_id', as: 'bloqueado' });
  };

  return BloqueioUsuario;
};
