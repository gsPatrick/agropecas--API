'use strict';

const { campos, esquema } = require('../../validacao');
const { RELATORIOS_EXPORTAVEIS, FORMATOS, TOP_MAXIMO } = require('./relatorio.constants');

/**
 * Entradas dos relatórios.
 *
 * `de` e `ate` são **obrigatórios em todos os esquemas**. O teto de tamanho do
 * período não mora aqui, e sim em `relatorio.comum.lerPeriodo`: a regra
 * envolve a diferença entre os dois campos, e validação de campo isolado não
 * enxerga a relação. Deixá-la no comum garante que ela valha também para o job
 * da fila, que não passa por middleware nenhum.
 */

const periodo = {
  de: campos.data().obrigatorio('Informe a data inicial do período.'),
  ate: campos.data().obrigatorio('Informe a data final do período.'),
};

const painel = esquema({
  ...periodo,
  top: campos.inteiro().min(1).max(TOP_MAXIMO),
});

const desempenho = esquema({
  ...periodo,
  top: campos.inteiro().min(1).max(TOP_MAXIMO),
  /* aceito no esquema, mas só honrado por quem tem escopo `todos` — quem
     decide é o RBAC no service, não a validação */
  usuarioId: campos.uuid(),
});

const busca = esquema({
  ...periodo,
  top: campos.inteiro().min(1).max(TOP_MAXIMO),
  uf: campos.texto().tamanho(2).max(2),
});

const exportar = esquema({
  ...periodo,
  relatorio: campos.umDe(RELATORIOS_EXPORTAVEIS).obrigatorio('Informe qual relatório exportar.'),
  formato: campos.umDe(FORMATOS).padrao('csv'),
  usuarioId: campos.uuid(),
  uf: campos.texto().max(2),
  top: campos.inteiro().min(1).max(TOP_MAXIMO),
});

const identificador = esquema({
  id: campos.uuid().obrigatorio('Informe o identificador.'),
});

const download = esquema({
  t: campos.texto().obrigatorio('Link inválido.').max(200),
});

module.exports = { painel, desempenho, busca, exportar, identificador, download };
