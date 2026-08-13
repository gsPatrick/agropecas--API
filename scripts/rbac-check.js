'use strict';

/** Audita o catálogo de RBAC sem tocar no banco. */

const { RECURSOS, PERMISSOES, PAPEIS, validar, CORINGA } = require('../src/rbac');

const problemas = validar();

console.log(`\nRBAC — ${Object.keys(RECURSOS).length} recursos · ${PERMISSOES.length} permissões · ${PAPEIS.length} papéis\n`);

Object.entries(RECURSOS).forEach(([recurso, definicao]) => {
  const doRecurso = PERMISSOES.filter((permissao) => permissao.recurso === recurso);
  console.log(`  ${recurso.padEnd(16)} ${definicao.rotulo.padEnd(28)} ${doRecurso.length} permissões`);
});

console.log('\nPapéis:\n');
PAPEIS.forEach((papel) => {
  const total = papel.permissoes.includes(CORINGA) ? 'TODAS (coringa)' : `${papel.permissoes.length} permissões`;
  console.log(`  ${papel.chave.padEnd(12)} ${total}`);
});

if (problemas.length) {
  console.error(`\n❌ ${problemas.length} problema(s):\n${problemas.join('\n')}\n`);
  process.exit(1);
}

console.log('\n✅ catálogo consistente\n');
