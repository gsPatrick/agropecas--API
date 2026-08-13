'use strict';

/** Estado — tabela de referência (IBGE). Não muda; serve a endereços e filtros. */
module.exports = (sequelize, DataTypes) => {
  const Estado = sequelize.define(
    'Estado',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      uf: { type: DataTypes.STRING(2), allowNull: false, unique: true },
      nome: { type: DataTypes.STRING(60), allowNull: false },
      codigo_ibge: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      regiao: { type: DataTypes.STRING(20), allowNull: true },
    },
    { tableName: 'estados', paranoid: false, timestamps: false }
  );

  Estado.associate = (models) => {
    Estado.hasMany(models.Municipio, { foreignKey: 'estado_id', as: 'municipios' });
  };

  return Estado;
};
