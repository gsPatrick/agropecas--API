'use strict';

/**
 * AnuncioFoto — imagens do anúncio.
 * Guarda `path` (chave no storage) separado da `url` pública: trocar de
 * provedor de arquivo não deve exigir reescrever URL em todas as linhas.
 */
module.exports = (sequelize, DataTypes) => {
  const AnuncioFoto = sequelize.define(
    'AnuncioFoto',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      anuncio_id: { type: DataTypes.UUID, allowNull: false },

      path: { type: DataTypes.STRING(500), allowNull: false },
      url: { type: DataTypes.STRING(500), allowNull: false },
      url_thumb: { type: DataTypes.STRING(500), allowNull: true },

      nome_original: { type: DataTypes.STRING(255), allowNull: true },
      mime: { type: DataTypes.STRING(60), allowNull: true },
      tamanho_bytes: { type: DataTypes.INTEGER, allowNull: true },
      largura: { type: DataTypes.INTEGER, allowNull: true },
      altura: { type: DataTypes.INTEGER, allowNull: true },

      ordem: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      principal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      texto_alternativo: { type: DataTypes.STRING(200), allowNull: true },

      moderada_em: { type: DataTypes.DATE, allowNull: true },
      bloqueada: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'imagem removida pela moderação sem apagar o anúncio inteiro',
      },
    },
    {
      tableName: 'anuncio_fotos',
      paranoid: true,
      indexes: [{ fields: ['anuncio_id', 'ordem'] }],
    }
  );

  AnuncioFoto.associate = (models) => {
    AnuncioFoto.belongsTo(models.Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });
  };

  return AnuncioFoto;
};
