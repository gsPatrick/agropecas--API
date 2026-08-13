'use strict';

const { CONSENTIMENTO_TIPO } = require('./constantes');

/**
 * Consentimento — registro IMUTÁVEL de cada aceite ou revogação (LGPD, art. 8º).
 *
 * Nunca é atualizado: revogar gera uma NOVA linha com `aceito = false`. Um
 * booleano no usuário não prova quando, de onde, nem a qual versão do texto
 * ele disse sim — e é essa prova que a lei exige.
 */
module.exports = (sequelize, DataTypes) => {
  const Consentimento = sequelize.define(
    'Consentimento',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: false },

      tipo: { type: DataTypes.ENUM(...CONSENTIMENTO_TIPO), allowNull: false },
      aceito: { type: DataTypes.BOOLEAN, allowNull: false },

      documento_legal_id: { type: DataTypes.UUID, allowNull: true },
      versao_documento: { type: DataTypes.STRING(20), allowNull: true },

      base_legal: {
        type: DataTypes.ENUM(
          'consentimento',
          'execucao_contrato',
          'obrigacao_legal',
          'legitimo_interesse',
          'exercicio_direitos'
        ),
        allowNull: false,
        defaultValue: 'consentimento',
      },
      finalidade: { type: DataTypes.STRING(255), allowNull: true },

      origem: {
        type: DataTypes.ENUM('cadastro', 'perfil', 'anuncio', 'admin', 'api', 'importacao'),
        allowNull: false,
        defaultValue: 'cadastro',
      },
      ip_hash: { type: DataTypes.STRING(64), allowNull: true },
      user_agent: { type: DataTypes.STRING(400), allowNull: true },
      revogado_em: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'consentimentos',
      paranoid: false,
      updatedAt: false,
      indexes: [
        { fields: ['usuario_id', 'tipo', 'criado_em'] },
        { fields: ['tipo'] },
      ],
    }
  );

  Consentimento.associate = (models) => {
    Consentimento.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
    Consentimento.belongsTo(models.DocumentoLegal, {
      foreignKey: 'documento_legal_id',
      as: 'documento',
    });
  };

  return Consentimento;
};
