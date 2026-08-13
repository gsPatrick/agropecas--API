'use strict';

const { TOKEN_TIPO } = require('./constantes');

/**
 * TokenVerificacao — código de e-mail, recuperação de senha e OTP.
 *
 * Também guarda hash, não o código. `tentativas` existe para travar força
 * bruta: 6 dígitos são 1 milhão de combinações, o que sem limite é pouco.
 */
module.exports = (sequelize, DataTypes) => {
  const TokenVerificacao = sequelize.define(
    'TokenVerificacao',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: false },

      tipo: { type: DataTypes.ENUM(...TOKEN_TIPO), allowNull: false },
      codigo_hash: { type: DataTypes.STRING(255), allowNull: false },
      destino: { type: DataTypes.STRING(180), allowNull: true, comment: 'e-mail ou telefone usado' },

      expira_em: { type: DataTypes.DATE, allowNull: false },
      usado_em: { type: DataTypes.DATE, allowNull: true },
      invalidado_em: { type: DataTypes.DATE, allowNull: true },

      tentativas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      max_tentativas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },

      ip_hash: { type: DataTypes.STRING(64), allowNull: true },
      user_agent: { type: DataTypes.STRING(400), allowNull: true },
    },
    {
      tableName: 'tokens_verificacao',
      paranoid: false,
      indexes: [
        { fields: ['usuario_id', 'tipo'] },
        { fields: ['expira_em'] },
      ],
    }
  );

  TokenVerificacao.associate = (models) => {
    TokenVerificacao.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
  };

  return TokenVerificacao;
};
