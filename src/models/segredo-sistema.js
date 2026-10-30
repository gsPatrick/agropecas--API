'use strict';

/**
 * Segredos que o próprio sistema gera e guarda (hoje: a chave que cifra as
 * credenciais do Mercado Pago). Fica fora de `configuracoes` de propósito:
 * aquela tabela é listada e editada pelo painel do Admin, e um segredo ali
 * apareceria na tela.
 */
module.exports = (sequelize, DataTypes) => {
  const SegredoSistema = sequelize.define(
    'SegredoSistema',
    {
      chave: { type: DataTypes.STRING(80), primaryKey: true },
      valor: { type: DataTypes.TEXT, allowNull: false },
    },
    { tableName: 'segredos_sistema', paranoid: false }
  );

  return SegredoSistema;
};
