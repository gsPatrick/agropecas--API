'use strict';

/** PerfilHorario — horário de atendimento (loja e prestador). 0 = domingo. */
module.exports = (sequelize, DataTypes) => {
  const PerfilHorario = sequelize.define(
    'PerfilHorario',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      perfil_id: { type: DataTypes.UUID, allowNull: false },
      dia_semana: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 0, max: 6 } },
      fechado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      abre_as: { type: DataTypes.TIME, allowNull: true },
      fecha_as: { type: DataTypes.TIME, allowNull: true },
      intervalo_inicio: { type: DataTypes.TIME, allowNull: true },
      intervalo_fim: { type: DataTypes.TIME, allowNull: true },
    },
    {
      tableName: 'perfil_horarios',
      paranoid: false,
      indexes: [{ unique: true, fields: ['perfil_id', 'dia_semana'] }],
    }
  );

  PerfilHorario.associate = (models) => {
    PerfilHorario.belongsTo(models.Perfil, { foreignKey: 'perfil_id', as: 'perfil' });
  };

  return PerfilHorario;
};
