'use strict';

/** PerfilServico — quais serviços o prestador presta. Alimenta o filtro de busca. */
module.exports = (sequelize, DataTypes) => {
  const PerfilServico = sequelize.define(
    'PerfilServico',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      perfil_id: { type: DataTypes.UUID, allowNull: false },
      servico_id: { type: DataTypes.UUID, allowNull: false },
      preco_referencia_centavos: { type: DataTypes.INTEGER, allowNull: true },
      observacao: { type: DataTypes.STRING(255), allowNull: true },
      principal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'perfil_servicos',
      paranoid: false,
      indexes: [{ unique: true, fields: ['perfil_id', 'servico_id'] }],
    }
  );

  return PerfilServico;
};
