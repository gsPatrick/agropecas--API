'use strict';

/** Espelha o catálogo de RBAC no banco. Rode a cada deploy. */

require('dotenv').config();
const db = require('../src/models');
const { sincronizar } = require('../src/rbac');

(async () => {
  try {
    await db.sequelize.authenticate();
    await sincronizar(db);
    console.log('[rbac] sincronizado');
    process.exit(0);
  } catch (erro) {
    console.error('[rbac] falhou:', erro.message);
    process.exit(1);
  }
})();
