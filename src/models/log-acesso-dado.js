'use strict';

/**
 * LogAcessoDado — LGPD: registro de ACESSO a dado pessoal de terceiro.
 *
 * Diferente da auditoria de alteração: aqui não houve mudança, houve LEITURA.
 * É o que responde "quem abriu o cadastro/conversa deste usuário e por quê" —
 * exigência prática quando o Admin pode ler conversa denunciada.
 */
module.exports = (sequelize, DataTypes) => {
  const LogAcessoDado = sequelize.define(
    'LogAcessoDado',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

      ator_id: { type: DataTypes.UUID, allowNull: false },
      titular_id: { type: DataTypes.UUID, allowNull: true },

      recurso: {
        type: DataTypes.STRING(60),
        allowNull: false,
        comment: 'cadastro, documento, conversa, endereco_exato, telefone…',
      },
      recurso_id: { type: DataTypes.UUID, allowNull: true },
      motivo: { type: DataTypes.STRING(255), allowNull: true },
      denuncia_id: { type: DataTypes.UUID, allowNull: true },

      ip_hash: { type: DataTypes.STRING(64), allowNull: true },
      user_agent: { type: DataTypes.STRING(400), allowNull: true },
    },
    {
      tableName: 'logs_acesso_dado',
      paranoid: false,
      updatedAt: false,
      indexes: [
        { fields: ['titular_id', 'criado_em'] },
        { fields: ['ator_id', 'criado_em'] },
      ],
    }
  );

  LogAcessoDado.associate = (models) => {
    LogAcessoDado.belongsTo(models.Usuario, { foreignKey: 'ator_id', as: 'ator' });
    LogAcessoDado.belongsTo(models.Usuario, { foreignKey: 'titular_id', as: 'titular' });
  };

  return LogAcessoDado;
};
