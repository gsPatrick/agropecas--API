'use strict';

/**
 * Municipio — referência IBGE com coordenada da sede.
 * A coordenada permite mapa e cálculo de distância mesmo quando o anúncio só
 * informou a cidade (localização aproximada).
 */
module.exports = (sequelize, DataTypes) => {
  const Municipio = sequelize.define(
    'Municipio',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      estado_id: { type: DataTypes.UUID, allowNull: false },
      nome: { type: DataTypes.STRING(120), allowNull: false },
      nome_normalizado: {
        type: DataTypes.STRING(120),
        allowNull: false,
        comment: 'sem acento e minúsculo — busca do usuário nunca vem acentuada',
      },
      uf: { type: DataTypes.STRING(2), allowNull: false },
      codigo_ibge: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
      longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
      populacao: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      tableName: 'municipios',
      paranoid: false,
      timestamps: false,
      indexes: [
        { fields: ['estado_id'] },
        { fields: ['nome_normalizado'] },
        { fields: ['uf'] },
      ],
    }
  );

  Municipio.associate = (models) => {
    Municipio.belongsTo(models.Estado, { foreignKey: 'estado_id', as: 'estado' });
    Municipio.hasMany(models.Endereco, { foreignKey: 'municipio_id', as: 'enderecos' });
  };

  return Municipio;
};
