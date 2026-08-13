'use strict';

const { ANUNCIO_STATUS } = require('./constantes');

/**
 * AnuncioHistorico — trilha imutável de mudança de estado.
 * É o que permite responder "quem ocultou este anúncio e por quê" — exigência
 * do poder de intervenção total do Admin (Maturacao/05, §2.4).
 */
module.exports = (sequelize, DataTypes) => {
  const AnuncioHistorico = sequelize.define(
    'AnuncioHistorico',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      anuncio_id: { type: DataTypes.UUID, allowNull: false },

      status_anterior: { type: DataTypes.ENUM(...ANUNCIO_STATUS), allowNull: true },
      status_novo: { type: DataTypes.ENUM(...ANUNCIO_STATUS), allowNull: false },

      ator_id: { type: DataTypes.UUID, allowNull: true },
      ator_papel: { type: DataTypes.STRING(40), allowNull: true },
      motivo: { type: DataTypes.TEXT, allowNull: true },
      alteracoes: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'diff dos campos alterados, quando a mudança não foi só de status',
      },
      ip_hash: { type: DataTypes.STRING(64), allowNull: true },
    },
    {
      tableName: 'anuncio_historico',
      paranoid: false,
      updatedAt: false,
      indexes: [{ fields: ['anuncio_id', 'criado_em'] }, { fields: ['ator_id'] }],
    }
  );

  AnuncioHistorico.associate = (models) => {
    AnuncioHistorico.belongsTo(models.Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });
    AnuncioHistorico.belongsTo(models.Usuario, { foreignKey: 'ator_id', as: 'ator' });
  };

  return AnuncioHistorico;
};
