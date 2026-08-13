'use strict';

/**
 * PerfilAreaAtendimento — municípios onde o prestador/loja atende.
 * É o que faz uma solicitação de Sapezal encontrar quem atende lá, mesmo que
 * o prestador esteja sediado em outra cidade.
 */
module.exports = (sequelize, DataTypes) => {
  const PerfilAreaAtendimento = sequelize.define(
    'PerfilAreaAtendimento',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      perfil_id: { type: DataTypes.UUID, allowNull: false },
      municipio_id: { type: DataTypes.UUID, allowNull: false },
      taxa_deslocamento_centavos: { type: DataTypes.INTEGER, allowNull: true },
      observacao: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: 'perfil_areas_atendimento',
      paranoid: false,
      indexes: [
        { unique: true, fields: ['perfil_id', 'municipio_id'] },
        { fields: ['municipio_id'] },
      ],
    }
  );

  return PerfilAreaAtendimento;
};
