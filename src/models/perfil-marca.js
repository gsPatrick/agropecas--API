'use strict';

/** PerfilMarca — marcas com que a loja trabalha ou que o prestador atende. */
module.exports = (sequelize, DataTypes) => {
  const PerfilMarca = sequelize.define(
    'PerfilMarca',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      perfil_id: { type: DataTypes.UUID, allowNull: false },
      marca_id: { type: DataTypes.UUID, allowNull: false },
      autorizada: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'revenda autorizada da marca — exige comprovação do Admin',
      },
    },
    {
      tableName: 'perfil_marcas',
      paranoid: false,
      indexes: [{ unique: true, fields: ['perfil_id', 'marca_id'] }],
    }
  );

  return PerfilMarca;
};
