'use strict';

/**
 * AnuncioContato — cada vez que alguém pediu para falar com o anunciante.
 *
 * A métrica diária diz QUANTOS contatos houve; esta tabela diz QUEM e QUANDO.
 * É o que sustenta três coisas que o agregado não resolve:
 *  · o anunciante ver quem o procurou, mesmo que a conversa tenha ido para o
 *    WhatsApp e nunca voltado à plataforma;
 *  · o Admin apurar denúncia de assédio ou spam por contato repetido;
 *  · medir a conversão real do produto (visualização → contato).
 *
 * LGPD: guarda vínculo entre duas pessoas. Expurgo junto com o anúncio.
 */
module.exports = (sequelize, DataTypes) => {
  const AnuncioContato = sequelize.define(
    'AnuncioContato',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      anuncio_id: { type: DataTypes.UUID, allowNull: false },
      anunciante_id: { type: DataTypes.UUID, allowNull: false },
      interessado_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'nulo no WhatsApp: o clique não exige login',
      },

      canal: { type: DataTypes.ENUM('whatsapp', 'chat', 'telefone', 'email'), allowNull: false },
      conversa_id: { type: DataTypes.UUID, allowNull: true },

      origem: {
        type: DataTypes.STRING(40),
        allowNull: true,
        comment: 'detalhe, listagem, busca, perfil, compartilhamento',
      },
      sessao_hash: { type: DataTypes.STRING(64), allowNull: true },
      ip_hash: { type: DataTypes.STRING(64), allowNull: true },
      user_agent: { type: DataTypes.STRING(400), allowNull: true },
    },
    {
      tableName: 'anuncio_contatos',
      paranoid: false,
      updatedAt: false,
      indexes: [
        { fields: ['anuncio_id', 'criado_em'] },
        { fields: ['anunciante_id', 'criado_em'] },
        { fields: ['interessado_id'] },
        { fields: ['canal'] },
      ],
    }
  );

  AnuncioContato.associate = (models) => {
    AnuncioContato.belongsTo(models.Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });
    AnuncioContato.belongsTo(models.Usuario, { foreignKey: 'anunciante_id', as: 'anunciante' });
    AnuncioContato.belongsTo(models.Usuario, { foreignKey: 'interessado_id', as: 'interessado' });
    AnuncioContato.belongsTo(models.Conversa, { foreignKey: 'conversa_id', as: 'conversa' });
  };

  return AnuncioContato;
};
