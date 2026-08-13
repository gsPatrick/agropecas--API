'use strict';

/**
 * Sanidade dos models: carrega tudo, resolve associações e lista o que existe.
 * Roda sem banco — serve para pegar erro de sintaxe e associação quebrada.
 */

require('dotenv').config();
const db = require('../src/models');

const models = Object.keys(db).filter((chave) => !['sequelize', 'Sequelize', 'constantes'].includes(chave));

console.log(`\n${models.length} models carregados:\n`);

models.sort().forEach((nome) => {
  const model = db[nome];
  const campos = Object.keys(model.rawAttributes).length;
  const relacoes = Object.keys(model.associations).length;
  console.log(
    `  ${nome.padEnd(24)} tabela: ${model.tableName.padEnd(28)} campos: ${String(campos).padStart(2)}  relações: ${relacoes}`
  );
});

console.log('\nOK — nenhum erro de definição ou associação.\n');
