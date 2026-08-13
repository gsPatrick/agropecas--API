'use strict';

const { TITULAR_SOLICITACAO_TIPO, TITULAR_SOLICITACAO_STATUS } = require('./constantes');

/**
 * SolicitacaoTitular — direitos do titular (LGPD, art. 18): acesso, correção,
 * exclusão, portabilidade, revogação.
 *
 * A lei dá prazo de resposta; sem uma fila registrada não há como cumprir nem
 * comprovar. `prazo_em` nasce preenchido no ato da abertura.
 */
module.exports = (sequelize, DataTypes) => {
  const SolicitacaoTitular = sequelize.define(
    'SolicitacaoTitular',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: true },
      email_solicitante: { type: DataTypes.STRING(180), allowNull: false },

      tipo: { type: DataTypes.ENUM(...TITULAR_SOLICITACAO_TIPO), allowNull: false },
      status: {
        type: DataTypes.ENUM(...TITULAR_SOLICITACAO_STATUS),
        allowNull: false,
        defaultValue: 'aberta',
      },

      descricao: { type: DataTypes.TEXT, allowNull: true },
      identidade_verificada_em: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'entregar dado pessoal sem confirmar quem pede é o próprio vazamento',
      },

      prazo_em: { type: DataTypes.DATE, allowNull: true },
      respondida_em: { type: DataTypes.DATE, allowNull: true },
      respondida_por: { type: DataTypes.UUID, allowNull: true },
      resposta: { type: DataTypes.TEXT, allowNull: true },
      arquivo_url: { type: DataTypes.STRING(500), allowNull: true, comment: 'export de portabilidade' },

      ip_hash: { type: DataTypes.STRING(64), allowNull: true },
    },
    {
      tableName: 'solicitacoes_titular',
      paranoid: false,
      indexes: [
        { fields: ['usuario_id'] },
        { fields: ['status', 'prazo_em'] },
      ],
    }
  );

  SolicitacaoTitular.associate = (models) => {
    SolicitacaoTitular.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
  };

  return SolicitacaoTitular;
};
