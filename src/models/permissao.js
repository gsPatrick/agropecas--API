'use strict';

/**
 * Permissao — capacidade granular no formato `recurso.acao[.escopo]`.
 * Exemplos: anuncio.criar · anuncio.editar.proprio · anuncio.editar.todos
 *
 * A autorização tem duas dimensões: CAPACIDADE (pode fazer?) e ESCOPO
 * (sobre quais registros?). O escopo é sufixo da chave e é aplicado no service.
 */
module.exports = (sequelize, DataTypes) => {
  const Permissao = sequelize.define(
    'Permissao',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      chave: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      recurso: { type: DataTypes.STRING(40), allowNull: false },
      acao: { type: DataTypes.STRING(40), allowNull: false },
      escopo: {
        type: DataTypes.ENUM('proprio', 'todos', 'nenhum'),
        allowNull: false,
        defaultValue: 'proprio',
      },
      descricao: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'permissoes',
      paranoid: false,
      indexes: [{ fields: ['recurso'] }],
    }
  );

  Permissao.associate = (models) => {
    Permissao.belongsToMany(models.Papel, {
      through: models.PapelPermissao,
      foreignKey: 'permissao_id',
      otherKey: 'papel_id',
      as: 'papeis',
    });
  };

  return Permissao;
};
