'use strict';

/**
 * Sessao — refresh token ativo por dispositivo.
 *
 * Guarda o HASH do token, nunca o token: vazamento da tabela não pode virar
 * acesso às contas. O IP também é hash (LGPD: pseudonimização) — serve para
 * detectar anomalia sem manter rastro de localização em claro.
 *
 * `token_anterior_hash` existe para DETECTAR ROUBO: como o refresh rotaciona a
 * cada uso, ninguém legítimo reapresenta o token anterior. Quando isso
 * acontece, há duas cópias circulando — a sessão inteira é derrubada.
 */
module.exports = (sequelize, DataTypes) => {
  const Sessao = sequelize.define(
    'Sessao',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: false },

      token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      token_anterior_hash: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'hash do refresh imediatamente anterior; usar de novo denuncia roubo',
      },
      reutilizacao_detectada_em: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'momento em que um refresh já rotacionado foi reapresentado',
      },
      dispositivo: { type: DataTypes.STRING(120), allowNull: true },
      user_agent: { type: DataTypes.STRING(400), allowNull: true },
      ip_hash: { type: DataTypes.STRING(64), allowNull: true },
      plataforma: { type: DataTypes.STRING(40), allowNull: true },

      ultima_atividade_em: { type: DataTypes.DATE, allowNull: true },
      expira_em: { type: DataTypes.DATE, allowNull: false },
      revogada_em: { type: DataTypes.DATE, allowNull: true },
      revogada_motivo: { type: DataTypes.STRING(120), allowNull: true },
    },
    {
      tableName: 'sessoes',
      paranoid: false,
      indexes: [
        { unique: true, fields: ['token_hash'] },
        { fields: ['usuario_id', 'revogada_em'] },
        { fields: ['expira_em'] },
        { fields: ['token_anterior_hash'] },
      ],
    }
  );

  Sessao.associate = (models) => {
    Sessao.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
  };

  return Sessao;
};
