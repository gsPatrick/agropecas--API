'use strict';

const { PLANO_PERIODICIDADE } = require('./constantes');

/**
 * Plano — preparado, não usado (Maturacao/03, §4).
 *
 * O MVP é gratuito: todo mundo entra no plano `gratuito_mvp`. A tabela existe
 * desde já para que ligar cobrança um dia seja INSERIR DADO, não refatorar o
 * núcleo. Nenhum gateway de pagamento entra aqui.
 */
module.exports = (sequelize, DataTypes) => {
  const Plano = sequelize.define(
    'Plano',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      chave: { type: DataTypes.STRING(40), allowNull: false, unique: true },
      nome: { type: DataTypes.STRING(80), allowNull: false },
      descricao: { type: DataTypes.TEXT, allowNull: true },

      preco_centavos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      periodicidade: {
        type: DataTypes.ENUM(...PLANO_PERIODICIDADE),
        allowNull: false,
        defaultValue: 'vitalicio',
      },
      dias_teste: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      publico: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      padrao: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'plano atribuído a todo cadastro novo',
      },
      ordem: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { tableName: 'planos', paranoid: true, indexes: [{ unique: true, fields: ['chave'] }] }
  );

  Plano.associate = (models) => {
    Plano.hasMany(models.PlanoLimite, { foreignKey: 'plano_id', as: 'limites' });
    Plano.hasMany(models.Assinatura, { foreignKey: 'plano_id', as: 'assinaturas' });
  };

  return Plano;
};
