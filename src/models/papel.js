'use strict';

/**
 * Papel — RBAC em dado, não em `if (usuario.tipo === 'admin')`.
 * Criar um papel novo (ex.: moderador de conteúdo) é configuração, não deploy.
 */
module.exports = (sequelize, DataTypes) => {
  const Papel = sequelize.define(
    'Papel',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      chave: { type: DataTypes.STRING(40), allowNull: false, unique: true },
      nome: { type: DataTypes.STRING(80), allowNull: false },
      descricao: { type: DataTypes.TEXT, allowNull: true },
      sistema: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'papel do sistema não pode ser removido pelo Admin',
      },
    },
    { tableName: 'papeis', paranoid: false }
  );

  Papel.associate = (models) => {
    Papel.belongsToMany(models.Usuario, {
      through: models.UsuarioPapel,
      foreignKey: 'papel_id',
      otherKey: 'usuario_id',
      as: 'usuarios',
    });
    Papel.belongsToMany(models.Permissao, {
      through: models.PapelPermissao,
      foreignKey: 'papel_id',
      otherKey: 'permissao_id',
      as: 'permissoes',
    });
  };

  return Papel;
};
