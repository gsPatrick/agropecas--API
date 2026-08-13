'use strict';

/**
 * Categoria — árvore de categorias de peça e de serviço.
 *
 * É TABELA e não enum porque o documento da cliente diz que o Admin gerencia
 * categorias (Maturacao/05, §2.4). Constante em código exigiria deploy para
 * cada categoria nova.
 */
module.exports = (sequelize, DataTypes) => {
  const Categoria = sequelize.define(
    'Categoria',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parent_id: { type: DataTypes.UUID, allowNull: true },

      nome: { type: DataTypes.STRING(120), allowNull: false },
      nome_normalizado: { type: DataTypes.STRING(120), allowNull: false },
      slug: { type: DataTypes.STRING(140), allowNull: false, unique: true },
      descricao: { type: DataTypes.TEXT, allowNull: true },

      tipo: {
        type: DataTypes.ENUM('peca', 'servico', 'ambos'),
        allowNull: false,
        defaultValue: 'peca',
      },
      icone: { type: DataTypes.STRING(40), allowNull: true, comment: 'nome do ícone no front' },
      imagem_url: { type: DataTypes.STRING(500), allowNull: true },

      ordem: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      destaque: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'aparece em "Peças mais procuradas hoje" na landing',
      },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      total_anuncios: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      seo_titulo: { type: DataTypes.STRING(180), allowNull: true },
      seo_descricao: { type: DataTypes.STRING(300), allowNull: true },
    },
    {
      tableName: 'categorias',
      paranoid: true,
      indexes: [
        { unique: true, fields: ['slug'] },
        { fields: ['parent_id'] },
        { fields: ['tipo'] },
        { fields: ['ativo', 'ordem'] },
      ],
    }
  );

  Categoria.associate = (models) => {
    Categoria.belongsTo(models.Categoria, { foreignKey: 'parent_id', as: 'pai' });
    Categoria.hasMany(models.Categoria, { foreignKey: 'parent_id', as: 'filhas' });
    Categoria.hasMany(models.Anuncio, { foreignKey: 'categoria_id', as: 'anuncios' });
  };

  return Categoria;
};
