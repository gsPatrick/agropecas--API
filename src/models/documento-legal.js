'use strict';

const { DOCUMENTO_LEGAL_TIPO } = require('./constantes');

/**
 * DocumentoLegal — versões de Termos de Uso e Política de Privacidade.
 *
 * Sem versionamento não há como provar A QUE TEXTO o usuário disse sim — e é
 * exatamente isso que a LGPD e o CDC pedem quando o documento muda.
 */
module.exports = (sequelize, DataTypes) => {
  const DocumentoLegal = sequelize.define(
    'DocumentoLegal',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tipo: { type: DataTypes.ENUM(...DOCUMENTO_LEGAL_TIPO), allowNull: false },
      versao: { type: DataTypes.STRING(20), allowNull: false },
      titulo: { type: DataTypes.STRING(180), allowNull: false },
      conteudo: { type: DataTypes.TEXT, allowNull: false },
      resumo_mudancas: { type: DataTypes.TEXT, allowNull: true },
      hash_conteudo: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'SHA-256 do texto: prova de integridade da versão aceita',
      },
      vigente_de: { type: DataTypes.DATE, allowNull: false },
      vigente_ate: { type: DataTypes.DATE, allowNull: true },
      exige_novo_aceite: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      publicado_por: { type: DataTypes.UUID, allowNull: true },
    },
    {
      tableName: 'documentos_legais',
      paranoid: false,
      indexes: [
        { unique: true, fields: ['tipo', 'versao'] },
        { fields: ['tipo', 'vigente_de'] },
      ],
    }
  );

  DocumentoLegal.associate = (models) => {
    DocumentoLegal.hasMany(models.Consentimento, {
      foreignKey: 'documento_legal_id',
      as: 'consentimentos',
    });
  };

  return DocumentoLegal;
};
