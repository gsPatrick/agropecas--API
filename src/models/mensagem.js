'use strict';

const { MENSAGEM_TIPO } = require('./constantes');

/**
 * Mensagem — conteúdo da conversa.
 *
 * `removida_em` em vez de DELETE: quem apaga uma mensagem não pode apagar a
 * prova de que ela existiu, senão a moderação de abuso fica sem base.
 * O conteúdo é substituído, o registro permanece.
 */
module.exports = (sequelize, DataTypes) => {
  const Mensagem = sequelize.define(
    'Mensagem',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      conversa_id: { type: DataTypes.UUID, allowNull: false },
      remetente_id: { type: DataTypes.UUID, allowNull: true, comment: 'nulo em mensagem do sistema' },

      tipo: { type: DataTypes.ENUM(...MENSAGEM_TIPO), allowNull: false, defaultValue: 'texto' },
      conteudo: { type: DataTypes.TEXT, allowNull: true },

      anexo_url: { type: DataTypes.STRING(500), allowNull: true },
      anexo_path: { type: DataTypes.STRING(500), allowNull: true },
      anexo_mime: { type: DataTypes.STRING(60), allowNull: true },
      anexo_tamanho_bytes: { type: DataTypes.INTEGER, allowNull: true },

      entregue_em: { type: DataTypes.DATE, allowNull: true },
      lida_em: { type: DataTypes.DATE, allowNull: true },

      editada_em: { type: DataTypes.DATE, allowNull: true },
      removida_em: { type: DataTypes.DATE, allowNull: true },
      removida_por: { type: DataTypes.UUID, allowNull: true },
      removida_motivo: { type: DataTypes.STRING(255), allowNull: true },

      denunciada: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      metadados: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'payload de mensagem de sistema (ex.: anúncio pausado, proposta)',
      },
    },
    {
      tableName: 'mensagens',
      paranoid: false,
      updatedAt: 'atualizado_em',
      indexes: [
        { fields: ['conversa_id', 'criado_em'] },
        { fields: ['remetente_id'] },
        { fields: ['lida_em'] },
      ],
    }
  );

  Mensagem.associate = (models) => {
    Mensagem.belongsTo(models.Conversa, { foreignKey: 'conversa_id', as: 'conversa' });
    Mensagem.belongsTo(models.Usuario, { foreignKey: 'remetente_id', as: 'remetente' });
  };

  return Mensagem;
};
