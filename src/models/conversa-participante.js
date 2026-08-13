'use strict';

/**
 * ConversaParticipante — o estado é POR PESSOA.
 *
 * Não lidas, arquivamento e silenciamento não podem ficar na conversa: o que
 * um leu não é o que o outro leu. Este é o registro que alimenta o contador do
 * balão e da caixa de entrada.
 */
module.exports = (sequelize, DataTypes) => {
  const ConversaParticipante = sequelize.define(
    'ConversaParticipante',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      conversa_id: { type: DataTypes.UUID, allowNull: false },
      usuario_id: { type: DataTypes.UUID, allowNull: false },

      papel: { type: DataTypes.ENUM('anunciante', 'interessado'), allowNull: false },

      nao_lidas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ultima_leitura_em: { type: DataTypes.DATE, allowNull: true },
      arquivada_em: { type: DataTypes.DATE, allowNull: true },
      silenciada_em: { type: DataTypes.DATE, allowNull: true },
      saiu_em: { type: DataTypes.DATE, allowNull: true },
      fixada: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'conversa_participantes',
      paranoid: false,
      indexes: [
        { unique: true, fields: ['conversa_id', 'usuario_id'] },
        { fields: ['usuario_id', 'nao_lidas'] },
      ],
    }
  );

  ConversaParticipante.associate = (models) => {
    ConversaParticipante.belongsTo(models.Conversa, { foreignKey: 'conversa_id', as: 'conversa' });
    ConversaParticipante.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
  };

  return ConversaParticipante;
};
