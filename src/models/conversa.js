'use strict';

const { CONVERSA_STATUS } = require('./constantes');

/**
 * Conversa — SEMPRE vinculada a um anúncio (Maturacao/05, §8.2.1).
 *
 * É o anúncio que dá contexto à mensagem, permite moderar com referência e
 * evita contato solto — que é por onde o spam começa. Por isso `anuncio_id`
 * é obrigatório e a unicidade é (anuncio, iniciante).
 */
module.exports = (sequelize, DataTypes) => {
  const Conversa = sequelize.define(
    'Conversa',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

      anuncio_id: { type: DataTypes.UUID, allowNull: false },
      anunciante_id: { type: DataTypes.UUID, allowNull: false },
      interessado_id: { type: DataTypes.UUID, allowNull: false },

      status: { type: DataTypes.ENUM(...CONVERSA_STATUS), allowNull: false, defaultValue: 'aberta' },

      ultima_mensagem_em: { type: DataTypes.DATE, allowNull: true },
      ultima_mensagem_previa: { type: DataTypes.STRING(160), allowNull: true },
      ultima_mensagem_de: { type: DataTypes.UUID, allowNull: true },
      total_mensagens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      encerrada_em: { type: DataTypes.DATE, allowNull: true },
      encerrada_por: { type: DataTypes.UUID, allowNull: true },
      bloqueada_motivo: { type: DataTypes.TEXT, allowNull: true },

      moderada_em: { type: DataTypes.DATE, allowNull: true },
      moderada_por: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'LGPD: leitura de conversa pelo Admin fica registrada aqui e em log_acesso_dado',
      },
    },
    {
      tableName: 'conversas',
      paranoid: true,
      indexes: [
        { unique: true, fields: ['anuncio_id', 'interessado_id'] },
        { fields: ['anunciante_id', 'ultima_mensagem_em'] },
        { fields: ['interessado_id', 'ultima_mensagem_em'] },
        { fields: ['status'] },
      ],
    }
  );

  Conversa.associate = (models) => {
    Conversa.belongsTo(models.Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });
    Conversa.belongsTo(models.Usuario, { foreignKey: 'anunciante_id', as: 'anunciante' });
    Conversa.belongsTo(models.Usuario, { foreignKey: 'interessado_id', as: 'interessado' });
    Conversa.hasMany(models.Mensagem, { foreignKey: 'conversa_id', as: 'mensagens' });
    Conversa.hasMany(models.ConversaParticipante, { foreignKey: 'conversa_id', as: 'participantes' });
  };

  return Conversa;
};
