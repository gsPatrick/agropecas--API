'use strict';

/** Favorito — anúncios salvos pelo usuário. */
module.exports = (sequelize, DataTypes) => {
  const Favorito = sequelize.define(
    'Favorito',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: false },
      anuncio_id: { type: DataTypes.UUID, allowNull: false },
      anotacao: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: 'favoritos',
      paranoid: false,
      updatedAt: false,
      indexes: [
        { unique: true, fields: ['usuario_id', 'anuncio_id'] },
        { fields: ['anuncio_id'] },
      ],
    }
  );

  Favorito.associate = (models) => {
    Favorito.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
    Favorito.belongsTo(models.Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });
  };

  return Favorito;
};
