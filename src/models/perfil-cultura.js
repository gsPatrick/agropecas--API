'use strict';

/**
 * PerfilCultura — o que este produtor planta/cria. Mesmo formato de
 * `perfil_servicos`: pivô com o mínimo de extras.
 *
 * `principal` existe porque a propriedade que faz soja + milho safrinha + um
 * talhão de feijão não trata as três igual — a oferta relevante é a da cultura
 * principal, e sem essa marca a listagem trataria todas com o mesmo peso.
 */
module.exports = (sequelize, DataTypes) => {
  const PerfilCultura = sequelize.define(
    'PerfilCultura',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      perfil_id: { type: DataTypes.UUID, allowNull: false },
      cultura_id: { type: DataTypes.UUID, allowNull: false },

      area_hectares: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'área dedicada a esta cultura — opcional, o total fica em perfis',
      },
      principal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'perfil_culturas',
      paranoid: false,
      indexes: [
        { unique: true, fields: ['perfil_id', 'cultura_id'] },
        /* "quem planta soja?" varre por cultura, não por perfil — sem este
           índice a pergunta que justifica a tabela seria um seq scan */
        { fields: ['cultura_id'] },
      ],
    }
  );

  return PerfilCultura;
};
