'use strict';

/**
 * Servico — catálogo de serviços que um prestador pode oferecer.
 *
 * ⚠️ A lista NÃO veio da cliente: o documento dela só diz "informar quais
 * serviços presta". Nasce vazia e é populada pelo Admin (seed inicial sugerido
 * na documentação).
 */
module.exports = (sequelize, DataTypes) => {
  const Servico = sequelize.define(
    'Servico',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      categoria_id: { type: DataTypes.UUID, allowNull: true },

      nome: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      nome_normalizado: { type: DataTypes.STRING(120), allowNull: false },
      slug: { type: DataTypes.STRING(140), allowNull: false, unique: true },
      descricao: { type: DataTypes.TEXT, allowNull: true },
      icone: { type: DataTypes.STRING(40), allowNull: true },

      ordem: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      total_prestadores: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'servicos',
      paranoid: true,
      indexes: [{ unique: true, fields: ['slug'] }, { fields: ['ativo', 'ordem'] }],
    }
  );

  Servico.associate = (models) => {
    Servico.belongsTo(models.Categoria, { foreignKey: 'categoria_id', as: 'categoria' });
    Servico.belongsToMany(models.Perfil, {
      through: models.PerfilServico,
      foreignKey: 'servico_id',
      otherKey: 'perfil_id',
      as: 'perfis',
    });
  };

  return Servico;
};
