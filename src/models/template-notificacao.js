'use strict';

const { NOTIFICACAO_TIPO, NOTIFICACAO_CANAL } = require('./constantes');

/**
 * TemplateNotificacao — o texto de cada aviso, por tipo e canal.
 *
 * Texto de e-mail dentro do código significa deploy para corrigir uma vírgula,
 * e impede a cliente de ajustar o tom das mensagens. Aqui o Admin edita.
 *
 * `variaveis` documenta o que o template aceita ({{nome}}, {{anuncio}}) —
 * sem isso ninguém sabe o que pode usar sem ler o service.
 */
module.exports = (sequelize, DataTypes) => {
  const TemplateNotificacao = sequelize.define(
    'TemplateNotificacao',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

      tipo: { type: DataTypes.ENUM(...NOTIFICACAO_TIPO), allowNull: false },
      canal: { type: DataTypes.ENUM(...NOTIFICACAO_CANAL), allowNull: false },

      assunto: { type: DataTypes.STRING(180), allowNull: true, comment: 'e-mail' },
      titulo: { type: DataTypes.STRING(160), allowNull: true },
      corpo: { type: DataTypes.TEXT, allowNull: false },
      corpo_html: { type: DataTypes.TEXT, allowNull: true },

      variaveis: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'lista das chaves aceitas pelo template',
      },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      atualizado_por: { type: DataTypes.UUID, allowNull: true },
    },
    {
      tableName: 'templates_notificacao',
      paranoid: false,
      indexes: [{ unique: true, fields: ['tipo', 'canal'] }],
    }
  );

  return TemplateNotificacao;
};
