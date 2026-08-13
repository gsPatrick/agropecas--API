'use strict';

/**
 * Conexão Sequelize. Também é o arquivo lido pelo sequelize-cli (migrations),
 * por isso exporta no formato de ambientes.
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');
const config = require('./index');

const opcoes = {
  host: config.db.host,
  port: config.db.port,
  dialect: 'postgres',
  logging: config.db.logging ? console.log : false,
  pool: config.db.pool,
  dialectOptions: config.db.ssl ? { ssl: { require: true, rejectUnauthorized: false } } : {},
  define: {
    // padrão do projeto: tabela/coluna em snake_case, timestamps em pt-BR
    underscored: true,
    freezeTableName: false,
    timestamps: true,
    createdAt: 'criado_em',
    updatedAt: 'atualizado_em',
    deletedAt: 'removido_em',
  },
};

const sequelize = new Sequelize(config.db.name, config.db.user, config.db.password, opcoes);

module.exports = sequelize;

// formato exigido pelo sequelize-cli
module.exports.development = { ...opcoes, database: config.db.name, username: config.db.user, password: config.db.password };
module.exports.test = module.exports.development;
module.exports.production = module.exports.development;
