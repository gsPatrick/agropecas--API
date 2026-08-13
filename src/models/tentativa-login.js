'use strict';

/**
 * TentativaLogin — histórico curto de autenticação, para bloqueio progressivo
 * e para responder "alguém tentou entrar na minha conta?".
 * Expurgo recomendado: 90 dias (ver documentacao/models/LGPD.md).
 */
module.exports = (sequelize, DataTypes) => {
  const TentativaLogin = sequelize.define(
    'TentativaLogin',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: true, comment: 'nulo se o e-mail não existe' },
      email_tentado: { type: DataTypes.STRING(180), allowNull: false },
      sucesso: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      motivo_falha: { type: DataTypes.STRING(60), allowNull: true },
      ip_hash: { type: DataTypes.STRING(64), allowNull: true },
      user_agent: { type: DataTypes.STRING(400), allowNull: true },
    },
    {
      tableName: 'tentativas_login',
      paranoid: false,
      updatedAt: false,
      indexes: [
        { fields: ['email_tentado', 'criado_em'] },
        { fields: ['ip_hash', 'criado_em'] },
      ],
    }
  );

  return TentativaLogin;
};
