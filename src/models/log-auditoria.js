'use strict';

const { AUDITORIA_ACAO } = require('./constantes');

/**
 * LogAuditoria — quem fez o quê, sobre qual registro, quando.
 *
 * O Admin tem poder de intervenção total (Maturacao/05, §2.4) — inclusive
 * publicar EM NOME DE outro usuário. Poder amplo exige rastro completo: por
 * isso `em_nome_de` é campo de primeira classe, não observação.
 */
module.exports = (sequelize, DataTypes) => {
  const LogAuditoria = sequelize.define(
    'LogAuditoria',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

      ator_id: { type: DataTypes.UUID, allowNull: true },
      ator_papel: { type: DataTypes.STRING(40), allowNull: true },
      em_nome_de: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'quando o Admin age representando outro usuário',
      },

      acao: { type: DataTypes.ENUM(...AUDITORIA_ACAO), allowNull: false },
      entidade: { type: DataTypes.STRING(60), allowNull: false },
      entidade_id: { type: DataTypes.UUID, allowNull: true },

      antes: { type: DataTypes.JSONB, allowNull: true },
      depois: { type: DataTypes.JSONB, allowNull: true },
      motivo: { type: DataTypes.TEXT, allowNull: true },

      ip_hash: { type: DataTypes.STRING(64), allowNull: true },
      user_agent: { type: DataTypes.STRING(400), allowNull: true },
      origem: { type: DataTypes.STRING(40), allowNull: true, comment: 'web, admin, api, worker' },
    },
    {
      tableName: 'logs_auditoria',
      paranoid: false,
      updatedAt: false,
      indexes: [
        { fields: ['entidade', 'entidade_id'] },
        { fields: ['ator_id', 'criado_em'] },
        { fields: ['acao'] },
        { fields: ['criado_em'] },
      ],
    }
  );

  LogAuditoria.associate = (models) => {
    LogAuditoria.belongsTo(models.Usuario, { foreignKey: 'ator_id', as: 'ator' });
  };

  return LogAuditoria;
};
