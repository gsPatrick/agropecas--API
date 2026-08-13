'use strict';

/**
 * BuscaLog — o que as pessoas procuraram.
 *
 * É a matéria-prima de "Peças mais procuradas hoje" e, mais importante, do
 * que NÃO existe na plataforma: busca com zero resultado é pedido de compra
 * que ninguém atendeu — a informação mais valiosa para chamar novos lojistas.
 */
module.exports = (sequelize, DataTypes) => {
  const BuscaLog = sequelize.define(
    'BuscaLog',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: true },

      termo: { type: DataTypes.STRING(160), allowNull: true },
      termo_normalizado: { type: DataTypes.STRING(160), allowNull: true },

      categoria_id: { type: DataTypes.UUID, allowNull: true },
      marca_id: { type: DataTypes.UUID, allowNull: true },
      maquina_id: { type: DataTypes.UUID, allowNull: true },
      municipio_id: { type: DataTypes.UUID, allowNull: true },
      uf: { type: DataTypes.STRING(2), allowNull: true },

      filtros: { type: DataTypes.JSONB, allowNull: true, comment: 'preço, condição, período, ordenação' },
      total_resultados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      sem_resultado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      clicou_em_anuncio_id: { type: DataTypes.UUID, allowNull: true },

      origem: { type: DataTypes.STRING(40), allowNull: true, comment: 'hero, listagem, header, atalho' },
      sessao_hash: { type: DataTypes.STRING(64), allowNull: true },
      ip_hash: { type: DataTypes.STRING(64), allowNull: true },
    },
    {
      tableName: 'busca_logs',
      paranoid: false,
      updatedAt: false,
      indexes: [
        { fields: ['termo_normalizado', 'criado_em'] },
        { fields: ['sem_resultado', 'criado_em'] },
        { fields: ['municipio_id'] },
      ],
    }
  );

  return BuscaLog;
};
