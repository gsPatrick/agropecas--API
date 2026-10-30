'use strict';

/**
 * Conta do Mercado Pago que pode receber os pagamentos da plataforma.
 *
 * Várias podem estar cadastradas; só uma fica `ativa` (índice parcial no
 * banco). `access_token` e `webhook_secret` ficam cifrados — quem lê o valor
 * real é o provider de pagamento, via `utils/cifra.js`; a API do painel só
 * devolve versão mascarada.
 */
module.exports = (sequelize, DataTypes) => {
  const ContaMercadoPago = sequelize.define(
    'ContaMercadoPago',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      apelido: { type: DataTypes.STRING(80), allowNull: false },
      tipo_pessoa: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'fisica' },
      modo: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'producao' },
      access_token: { type: DataTypes.TEXT, allowNull: false },
      public_key: { type: DataTypes.STRING(120), allowNull: true },
      webhook_secret: { type: DataTypes.TEXT, allowNull: true },
      ativa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      mp_user_id: { type: DataTypes.STRING(30), allowNull: true },
      mp_email: { type: DataTypes.STRING(160), allowNull: true },
      mp_nickname: { type: DataTypes.STRING(120), allowNull: true },
      verificada_em: { type: DataTypes.DATE, allowNull: true },
      ativada_em: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'contas_mercadopago', paranoid: false }
  );

  return ContaMercadoPago;
};
