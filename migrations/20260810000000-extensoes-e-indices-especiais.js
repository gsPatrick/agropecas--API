'use strict';

/**
 * Primeira migration: extensões do Postgres e índices que o Sequelize não
 * expressa na definição do model.
 *
 * As migrations de tabela são criadas MÓDULO A MÓDULO, junto com cada feature —
 * assim cada entrega carrega o schema que ela precisa, e não um bloco único
 * impossível de revisar.
 */

module.exports = {
  async up(queryInterface) {
    // uuid_generate_v4() e gen_random_uuid()
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    // busca por similaridade: "rolamentu" precisa achar "rolamento"
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm";');

    // remove acento em índice e comparação — o usuário nunca digita acentuado
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "unaccent";');
  },

  async down(queryInterface) {
    // extensões não são derrubadas: outras tabelas podem depender delas
    await queryInterface.sequelize.query('SELECT 1;');
  },
};
