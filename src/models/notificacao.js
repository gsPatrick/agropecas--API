'use strict';

const { NOTIFICACAO_TIPO, NOTIFICACAO_CANAL } = require('./constantes');

/**
 * Notificacao — um registro por AVISO ENTREGUE, com o canal.
 * A mesma ocorrência pode gerar linhas em canais diferentes (sistema + e-mail):
 * é assim que se sabe o que realmente saiu e o que falhou.
 */
module.exports = (sequelize, DataTypes) => {
  const Notificacao = sequelize.define(
    'Notificacao',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: false },

      tipo: { type: DataTypes.ENUM(...NOTIFICACAO_TIPO), allowNull: false },
      canal: { type: DataTypes.ENUM(...NOTIFICACAO_CANAL), allowNull: false, defaultValue: 'sistema' },

      titulo: { type: DataTypes.STRING(160), allowNull: false },
      corpo: { type: DataTypes.TEXT, allowNull: true },
      link: { type: DataTypes.STRING(500), allowNull: true },
      dados: { type: DataTypes.JSONB, allowNull: true },

      referencia_tipo: { type: DataTypes.STRING(40), allowNull: true },
      referencia_id: { type: DataTypes.UUID, allowNull: true },

      lida_em: { type: DataTypes.DATE, allowNull: true },
      enviada_em: { type: DataTypes.DATE, allowNull: true },
      falha_em: { type: DataTypes.DATE, allowNull: true },
      falha_motivo: { type: DataTypes.TEXT, allowNull: true },
      tentativas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'notificacoes',
      paranoid: false,
      indexes: [
        { fields: ['usuario_id', 'lida_em'] },
        { fields: ['tipo'] },
        { fields: ['criado_em'] },
      ],
    }
  );

  Notificacao.associate = (models) => {
    Notificacao.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
  };

  return Notificacao;
};
