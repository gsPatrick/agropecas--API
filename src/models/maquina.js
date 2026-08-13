'use strict';

/**
 * Maquina — modelo de maquinário. É o que sustenta o "Busque por máquina":
 * quem não sabe o nome da peça sabe o trator que tem.
 */
module.exports = (sequelize, DataTypes) => {
  const Maquina = sequelize.define(
    'Maquina',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      marca_id: { type: DataTypes.UUID, allowNull: false },

      modelo: { type: DataTypes.STRING(120), allowNull: false },
      modelo_normalizado: { type: DataTypes.STRING(120), allowNull: false },
      slug: { type: DataTypes.STRING(160), allowNull: false, unique: true },

      categoria_maquina: {
        type: DataTypes.ENUM(
          'trator',
          'colheitadeira',
          'pulverizador',
          'plantadeira',
          'implemento',
          'caminhao',
          'motor',
          'outro'
        ),
        allowNull: false,
        defaultValue: 'trator',
      },
      ano_inicio: { type: DataTypes.INTEGER, allowNull: true },
      ano_fim: { type: DataTypes.INTEGER, allowNull: true },
      potencia_cv: { type: DataTypes.INTEGER, allowNull: true },
      observacao: { type: DataTypes.TEXT, allowNull: true },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: 'maquinas',
      paranoid: true,
      indexes: [
        { unique: true, fields: ['slug'] },
        { fields: ['marca_id'] },
        { fields: ['modelo_normalizado'] },
      ],
    }
  );

  Maquina.associate = (models) => {
    Maquina.belongsTo(models.Marca, { foreignKey: 'marca_id', as: 'marca' });
    Maquina.belongsToMany(models.Anuncio, {
      through: models.AnuncioMaquina,
      foreignKey: 'maquina_id',
      otherKey: 'anuncio_id',
      as: 'anuncios',
    });
  };

  return Maquina;
};
