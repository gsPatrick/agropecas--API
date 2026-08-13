'use strict';

/**
 * Configuracao — parâmetros que o Admin muda sem deploy: dias até o anúncio
 * expirar, limite de fotos, texto do banner, contato de suporte.
 *
 * Não guardar segredo aqui — credencial vive em variável de ambiente.
 */
module.exports = (sequelize, DataTypes) => {
  const Configuracao = sequelize.define(
    'Configuracao',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      chave: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      valor: { type: DataTypes.JSONB, allowNull: true },
      tipo: {
        type: DataTypes.ENUM('texto', 'numero', 'booleano', 'json', 'lista'),
        allowNull: false,
        defaultValue: 'texto',
      },
      grupo: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'geral' },
      descricao: { type: DataTypes.STRING(255), allowNull: true },
      publica: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'true = pode ser servida ao front sem autenticação',
      },
      atualizado_por: { type: DataTypes.UUID, allowNull: true },
    },
    {
      tableName: 'configuracoes',
      paranoid: false,
      indexes: [{ unique: true, fields: ['chave'] }, { fields: ['grupo'] }],
    }
  );

  return Configuracao;
};
