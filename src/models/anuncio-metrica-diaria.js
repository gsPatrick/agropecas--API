'use strict';

/**
 * AnuncioMetricaDiaria — agregado por dia.
 *
 * Uma linha por visualização cresceria sem limite e ninguém consulta evento
 * cru. Aqui uma linha por anúncio/dia responde "quantas visitas na semana"
 * com um SUM barato.
 */
module.exports = (sequelize, DataTypes) => {
  const AnuncioMetricaDiaria = sequelize.define(
    'AnuncioMetricaDiaria',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      anuncio_id: { type: DataTypes.UUID, allowNull: false },
      data: { type: DataTypes.DATEONLY, allowNull: false },

      visualizacoes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      visualizacoes_unicas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      cliques_whatsapp: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      conversas_iniciadas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      favoritos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      compartilhamentos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'anuncio_metricas_diarias',
      paranoid: false,
      indexes: [
        { unique: true, fields: ['anuncio_id', 'data'] },
        { fields: ['data'] },
      ],
    }
  );

  AnuncioMetricaDiaria.associate = (models) => {
    AnuncioMetricaDiaria.belongsTo(models.Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });
  };

  return AnuncioMetricaDiaria;
};
