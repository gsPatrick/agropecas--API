'use strict';

/** AnuncioMaquina — em quais máquinas a peça serve. Base do "Busque por máquina". */
module.exports = (sequelize, DataTypes) => {
  const AnuncioMaquina = sequelize.define(
    'AnuncioMaquina',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      anuncio_id: { type: DataTypes.UUID, allowNull: false },
      maquina_id: { type: DataTypes.UUID, allowNull: false },
      observacao: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: 'anuncio_maquinas',
      paranoid: false,
      indexes: [
        { unique: true, fields: ['anuncio_id', 'maquina_id'] },
        { fields: ['maquina_id'] },
      ],
    }
  );

  return AnuncioMaquina;
};
