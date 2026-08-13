'use strict';

/**
 * Carregador de models.
 *
 * Lê todos os arquivos desta pasta, registra no Sequelize e só depois roda as
 * associações — associar durante o carregamento quebraria na primeira
 * referência a um model ainda não lido.
 */

const fs = require('fs');
const path = require('path');
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const IGNORAR = ['index.js', 'constantes.js'];

const db = {};

fs.readdirSync(__dirname)
  .filter((arquivo) => arquivo.endsWith('.js') && !IGNORAR.includes(arquivo))
  .sort()
  .forEach((arquivo) => {
    const definir = require(path.join(__dirname, arquivo));
    const model = definir(sequelize, DataTypes);
    db[model.name] = model;
  });

Object.values(db).forEach((model) => {
  if (typeof model.associate === 'function') model.associate(db);
});

db.sequelize = sequelize;
db.Sequelize = require('sequelize');
db.constantes = require('./constantes');

module.exports = db;
