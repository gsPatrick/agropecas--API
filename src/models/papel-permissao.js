'use strict';

/** PapelPermissao — N:N entre papel e permissão. */
module.exports = (sequelize, DataTypes) => {
  const PapelPermissao = sequelize.define(
    'PapelPermissao',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      papel_id: { type: DataTypes.UUID, allowNull: false },
      permissao_id: { type: DataTypes.UUID, allowNull: false },
    },
    {
      tableName: 'papel_permissoes',
      paranoid: false,
      indexes: [{ unique: true, fields: ['papel_id', 'permissao_id'] }],
    }
  );

  return PapelPermissao;
};
