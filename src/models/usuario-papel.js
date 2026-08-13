'use strict';

/** UsuarioPapel — N:N. Um usuário pode acumular papéis (ex.: admin que também anuncia). */
module.exports = (sequelize, DataTypes) => {
  const UsuarioPapel = sequelize.define(
    'UsuarioPapel',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: false },
      papel_id: { type: DataTypes.UUID, allowNull: false },
      concedido_por: { type: DataTypes.UUID, allowNull: true },
      concedido_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      expira_em: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'usuario_papeis',
      paranoid: false,
      indexes: [{ unique: true, fields: ['usuario_id', 'papel_id'] }],
    }
  );

  return UsuarioPapel;
};
