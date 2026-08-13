'use strict';

/** Marca — fabricante de máquina ou de peça (John Deere, Bosch, Valtra…). */
module.exports = (sequelize, DataTypes) => {
  const Marca = sequelize.define(
    'Marca',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      nome: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      nome_normalizado: { type: DataTypes.STRING(100), allowNull: false },
      slug: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      logo_url: { type: DataTypes.STRING(500), allowNull: true },
      tipo: {
        type: DataTypes.ENUM('maquina', 'peca', 'ambos'),
        allowNull: false,
        defaultValue: 'ambos',
      },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ordem: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'marcas',
      paranoid: true,
      indexes: [{ unique: true, fields: ['slug'] }, { fields: ['nome_normalizado'] }],
    }
  );

  Marca.associate = (models) => {
    Marca.hasMany(models.Maquina, { foreignKey: 'marca_id', as: 'maquinas' });
    Marca.hasMany(models.Anuncio, { foreignKey: 'marca_id', as: 'anuncios' });
    Marca.belongsToMany(models.Perfil, {
      through: models.PerfilMarca,
      foreignKey: 'marca_id',
      otherKey: 'perfil_id',
      as: 'perfis',
    });
  };

  return Marca;
};
