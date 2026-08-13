'use strict';

const { ENDERECO_ORIGEM, PRECISAO_LOCALIZACAO } = require('./constantes');

/**
 * Endereco — usado por Perfil e por Anuncio.
 *
 * Guarda SEMPRE as duas coisas (Maturacao/05, §9.1):
 *  · o endereço textual, para busca e filtro;
 *  · a coordenada, para mapa e distância.
 * Sem coordenada não há cálculo de distância; sem texto não há filtro por
 * município.
 *
 * `origem` registra como o dado chegou (CEP, coordenada colada, pino no mapa
 * ou só município) — é o que permite saber a confiabilidade depois.
 */
module.exports = (sequelize, DataTypes) => {
  const Endereco = sequelize.define(
    'Endereco',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

      cep: { type: DataTypes.STRING(8), allowNull: true, comment: 'somente dígitos' },
      logradouro: { type: DataTypes.STRING(200), allowNull: true },
      numero: { type: DataTypes.STRING(20), allowNull: true },
      complemento: { type: DataTypes.STRING(120), allowNull: true },
      bairro: { type: DataTypes.STRING(120), allowNull: true },
      referencia: { type: DataTypes.STRING(200), allowNull: true },

      municipio_id: { type: DataTypes.UUID, allowNull: true },
      municipio_nome: { type: DataTypes.STRING(120), allowNull: true, comment: 'cópia para histórico' },
      uf: { type: DataTypes.STRING(2), allowNull: true },
      pais: { type: DataTypes.STRING(2), allowNull: false, defaultValue: 'BR' },

      latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
      longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },

      origem: { type: DataTypes.ENUM(...ENDERECO_ORIGEM), allowNull: false, defaultValue: 'cep' },
      precisao: {
        type: DataTypes.ENUM(...PRECISAO_LOCALIZACAO),
        allowNull: false,
        defaultValue: 'aproximada',
      },
      validado_em: { type: DataTypes.DATE, allowNull: true },
      retorno_bruto: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'resposta original do ViaCEP/geocoder, para auditoria da origem do dado',
      },
    },
    {
      tableName: 'enderecos',
      paranoid: true,
      indexes: [
        { fields: ['municipio_id'] },
        { fields: ['cep'] },
        { fields: ['uf'] },
        { fields: ['latitude', 'longitude'] },
      ],
    }
  );

  Endereco.associate = (models) => {
    Endereco.belongsTo(models.Municipio, { foreignKey: 'municipio_id', as: 'municipio' });
    Endereco.hasMany(models.Anuncio, { foreignKey: 'endereco_id', as: 'anuncios' });
    Endereco.hasMany(models.Perfil, { foreignKey: 'endereco_id', as: 'perfis' });
  };

  return Endereco;
};
