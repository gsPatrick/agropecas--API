'use strict';

/**
 * TermoPopular — agregado diário do BuscaLog.
 * A landing pergunta "o que é mais procurado hoje" a cada visita; varrer o log
 * cru nessa frequência é caro. Um job diário consolida aqui.
 */
module.exports = (sequelize, DataTypes) => {
  const TermoPopular = sequelize.define(
    'TermoPopular',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      data: { type: DataTypes.DATEONLY, allowNull: false },
      termo_normalizado: { type: DataTypes.STRING(160), allowNull: false },
      termo_exibicao: { type: DataTypes.STRING(160), allowNull: false },
      uf: { type: DataTypes.STRING(2), allowNull: true },
      categoria_id: { type: DataTypes.UUID, allowNull: true },
      total_buscas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total_sem_resultado: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'termos_populares',
      paranoid: false,
      indexes: [
        { unique: true, fields: ['data', 'termo_normalizado', 'uf'] },
        { fields: ['data', 'total_buscas'] },
      ],
    }
  );

  return TermoPopular;
};
