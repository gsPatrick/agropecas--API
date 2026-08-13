'use strict';

/**
 * PlanoLimite — quota por chave (`anuncios.ativos`, `fotos.por_anuncio`…).
 *
 * `valor = null` significa ILIMITADO, que é o caso de todo mundo no MVP. O
 * service pergunta `limite(usuario, chave)` e hoje sempre recebe "sem limite";
 * ligar cobrança vira alterar dado.
 */
module.exports = (sequelize, DataTypes) => {
  const PlanoLimite = sequelize.define(
    'PlanoLimite',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      plano_id: { type: DataTypes.UUID, allowNull: false },
      chave: { type: DataTypes.STRING(60), allowNull: false },
      valor: { type: DataTypes.INTEGER, allowNull: true, comment: 'null = ilimitado' },
      periodo: {
        type: DataTypes.ENUM('total', 'dia', 'semana', 'mes'),
        allowNull: false,
        defaultValue: 'total',
      },
      descricao: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: 'plano_limites',
      paranoid: false,
      indexes: [{ unique: true, fields: ['plano_id', 'chave'] }],
    }
  );

  PlanoLimite.associate = (models) => {
    PlanoLimite.belongsTo(models.Plano, { foreignKey: 'plano_id', as: 'plano' });
  };

  return PlanoLimite;
};
