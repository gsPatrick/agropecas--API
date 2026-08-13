'use strict';

const { DENUNCIA_ALVO, DENUNCIA_STATUS } = require('./constantes');

/**
 * Denuncia — uma tabela para todos os alvos (anúncio, perfil, mensagem).
 * Três tabelas quase idênticas dariam três telas de moderação; aqui o Admin
 * tem uma fila só.
 */
module.exports = (sequelize, DataTypes) => {
  const Denuncia = sequelize.define(
    'Denuncia',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

      alvo_tipo: { type: DataTypes.ENUM(...DENUNCIA_ALVO), allowNull: false },
      alvo_id: { type: DataTypes.UUID, allowNull: false },

      denunciante_id: { type: DataTypes.UUID, allowNull: true, comment: 'nulo se anônima' },
      denunciado_id: { type: DataTypes.UUID, allowNull: true },

      motivo: {
        type: DataTypes.ENUM(
          'spam',
          'golpe',
          'produto_proibido',
          'produto_falsificado',
          'conteudo_ofensivo',
          'informacao_falsa',
          'duplicado',
          'outro'
        ),
        allowNull: false,
      },
      descricao: { type: DataTypes.TEXT, allowNull: true },
      evidencia_url: { type: DataTypes.STRING(500), allowNull: true },

      status: { type: DataTypes.ENUM(...DENUNCIA_STATUS), allowNull: false, defaultValue: 'aberta' },
      resolvida_por: { type: DataTypes.UUID, allowNull: true },
      resolvida_em: { type: DataTypes.DATE, allowNull: true },
      resolucao: { type: DataTypes.TEXT, allowNull: true },
      acao_tomada: { type: DataTypes.STRING(80), allowNull: true },

      ip_hash: { type: DataTypes.STRING(64), allowNull: true },
    },
    {
      tableName: 'denuncias',
      paranoid: false,
      indexes: [
        { fields: ['alvo_tipo', 'alvo_id'] },
        { fields: ['status', 'criado_em'] },
        { fields: ['denunciado_id'] },
      ],
    }
  );

  Denuncia.associate = (models) => {
    Denuncia.belongsTo(models.Usuario, { foreignKey: 'denunciante_id', as: 'denunciante' });
    Denuncia.belongsTo(models.Usuario, { foreignKey: 'denunciado_id', as: 'denunciado' });
  };

  return Denuncia;
};
