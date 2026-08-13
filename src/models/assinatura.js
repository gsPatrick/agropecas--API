'use strict';

const { ASSINATURA_STATUS } = require('./constantes');

/**
 * Assinatura — vínculo usuário × plano.
 * Todo cadastro já nasce com uma, no plano gratuito: assim o resto do sistema
 * sempre encontra um plano e não precisa tratar o caso "usuário sem plano".
 */
module.exports = (sequelize, DataTypes) => {
  const Assinatura = sequelize.define(
    'Assinatura',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: false },
      plano_id: { type: DataTypes.UUID, allowNull: false },

      status: { type: DataTypes.ENUM(...ASSINATURA_STATUS), allowNull: false, defaultValue: 'ativa' },
      inicio_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      fim_em: { type: DataTypes.DATE, allowNull: true },
      renova_em: { type: DataTypes.DATE, allowNull: true },
      cancelada_em: { type: DataTypes.DATE, allowNull: true },
      cancelamento_motivo: { type: DataTypes.STRING(255), allowNull: true },

      origem: {
        type: DataTypes.ENUM('cadastro', 'admin', 'migracao', 'compra'),
        allowNull: false,
        defaultValue: 'cadastro',
      },
      referencia_externa: {
        type: DataTypes.STRING(120),
        allowNull: true,
        comment: 'id no gateway, quando existir cobrança — o núcleo não conhece o provedor',
      },
    },
    {
      tableName: 'assinaturas',
      paranoid: false,
      indexes: [
        { fields: ['usuario_id', 'status'] },
        { fields: ['plano_id'] },
      ],
    }
  );

  Assinatura.associate = (models) => {
    Assinatura.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
    Assinatura.belongsTo(models.Plano, { foreignKey: 'plano_id', as: 'plano' });
  };

  return Assinatura;
};
