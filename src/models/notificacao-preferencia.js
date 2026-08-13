'use strict';

const { NOTIFICACAO_TIPO, NOTIFICACAO_CANAL } = require('./constantes');

/**
 * NotificacaoPreferencia — o que cada usuário aceita receber, por canal.
 * LGPD: comunicação de marketing exige opt-in explícito; aviso transacional
 * (mensagem nova, anúncio reprovado) é legítimo interesse e nasce ligado.
 */
module.exports = (sequelize, DataTypes) => {
  const NotificacaoPreferencia = sequelize.define(
    'NotificacaoPreferencia',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: false },
      tipo: { type: DataTypes.ENUM(...NOTIFICACAO_TIPO), allowNull: false },
      canal: { type: DataTypes.ENUM(...NOTIFICACAO_CANAL), allowNull: false },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: 'notificacao_preferencias',
      paranoid: false,
      indexes: [{ unique: true, fields: ['usuario_id', 'tipo', 'canal'] }],
    }
  );

  NotificacaoPreferencia.associate = (models) => {
    NotificacaoPreferencia.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
  };

  return NotificacaoPreferencia;
};
