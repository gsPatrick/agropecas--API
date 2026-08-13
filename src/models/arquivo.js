'use strict';

/**
 * Arquivo — inventário de tudo que sobe para o storage.
 *
 * Sem isto, imagem removida do anúncio vira lixo pago para sempre no bucket, e
 * não há como cumprir pedido de exclusão do titular sobre arquivos.
 */
module.exports = (sequelize, DataTypes) => {
  const Arquivo = sequelize.define(
    'Arquivo',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: true },

      driver: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'local' },
      bucket: { type: DataTypes.STRING(80), allowNull: true },
      path: { type: DataTypes.STRING(500), allowNull: false },
      url: { type: DataTypes.STRING(500), allowNull: false },

      nome_original: { type: DataTypes.STRING(255), allowNull: true },
      mime: { type: DataTypes.STRING(60), allowNull: true },
      tamanho_bytes: { type: DataTypes.INTEGER, allowNull: true },
      hash_conteudo: { type: DataTypes.STRING(64), allowNull: true, comment: 'evita duplicata' },

      referencia_tipo: { type: DataTypes.STRING(40), allowNull: true },
      referencia_id: { type: DataTypes.UUID, allowNull: true },

      descartar_em: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'órfão marcado para faxina do worker',
      },
    },
    {
      tableName: 'arquivos',
      paranoid: true,
      indexes: [
        { fields: ['referencia_tipo', 'referencia_id'] },
        { fields: ['usuario_id'] },
        { fields: ['hash_conteudo'] },
      ],
    }
  );

  Arquivo.associate = (models) => {
    Arquivo.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
  };

  return Arquivo;
};
