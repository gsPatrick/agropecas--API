'use strict';

/**
 * Executor das suítes — o único ponto de entrada de `npm test`.
 *
 * PORQUÊ ELE EXISTE: as suítes são testes de integração de verdade (sobem a
 * app, gravam no Postgres, usam Redis). Até aqui elas escreviam no MESMO banco
 * do desenvolvimento, então cada `npm test` deixava resíduo visível na tela:
 * categorias "Teste 1786…", documentos legais com versão absurda, dezenas de
 * usuários de teste, anúncios sem município. O ambiente de trabalho virava
 * refém da suíte.
 *
 * A correção NÃO foi mexer em teste por teste (são 30 arquivos e todos fixam
 * `NODE_ENV=development` por conta própria): foi mover a fronteira para o
 * ambiente. Este runner define `DB_NAME` e `REDIS_PREFIXO` ANTES de o Node do
 * teste subir. Como `src/config` lê `process.env` e o `dotenv` nunca
 * sobrescreve variável já definida, todo o processo filho — app, models,
 * sequelize-cli, cache — enxerga o banco de teste sem que nenhuma linha de
 * teste precise saber disso.
 *
 * Uso:
 *   node scripts/testar.js               → todas as suítes, na ordem
 *   node scripts/testar.js catalogo      → só testes/catalogo.test.js
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(RAIZ, '.env') });

/* nome derivado do banco de desenvolvimento: quem clonar o projeto e usar
   outro nome de banco continua ganhando um "_test" correspondente, sem ter
   que descobrir mais uma variável */
const bancoDev = process.env.DB_NAME || 'agropecas';
const bancoTeste = process.env.DB_TEST_NAME || `${bancoDev.replace(/_dev$/, '')}_test`;

process.env.DB_NAME = bancoTeste;
/* o cache é namespaced por `prefixo:ambiente` e as suítes forçam
   NODE_ENV=development; sem trocar o prefixo elas envenenariam o cache que a
   API de desenvolvimento está servindo — foi exatamente assim que a tela
   continuou mostrando lixo depois de limpo */
process.env.REDIS_PREFIXO = `${process.env.REDIS_PREFIXO || 'agropecas'}_test`;

const ambiente = { ...process.env };

/* ─── 1. garantir que o banco de teste existe ─────────────────────────── */
async function garantirBanco() {
  const { Client } = require('pg');
  const cliente = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || undefined,
    database: 'postgres', // banco administrativo: CREATE DATABASE não roda de dentro do alvo
  });
  await cliente.connect();
  const { rows } = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [bancoTeste]);
  let criado = false;
  if (!rows.length) {
    await cliente.query(`CREATE DATABASE "${bancoTeste}"`);
    criado = true;
    console.log(`[testar] banco ${bancoTeste} criado`);
  }
  await cliente.end();
  return criado;
}

function sequelizeCli(...args) {
  const bin = path.join(RAIZ, 'node_modules', '.bin', 'sequelize-cli');
  const r = spawnSync(bin, args, { cwd: RAIZ, env: ambiente, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[testar] falhou: sequelize-cli ${args.join(' ')}`);
    process.exit(1);
  }
}

/* seeds só quando o banco está vazio de RBAC: os seeders não são idempotentes
   e reexecutá-los duplicaria papéis/municípios a cada rodada */
async function precisaSeed() {
  const { Client } = require('pg');
  const cliente = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || undefined,
    database: bancoTeste,
  });
  await cliente.connect();
  const { rows } = await cliente.query('SELECT count(*)::int AS n FROM papeis');
  await cliente.end();
  return rows[0].n === 0;
}

/* ─── 2. lista de suítes, na mesma ordem que o `npm test` antigo ──────── */
const SUITES = [
  'auth.fluxo', 'auth.rbac', 'auth.seguranca', 'configuracao', 'usuario', 'midia',
  'catalogo', 'perfil', 'localizacao', 'busca', 'anuncio', 'favorito', 'contato',
  'conversa', 'notificacao', 'denuncia', 'moderacao', 'plano', 'relatorio', 'lgpd',
  'auditoria',
  'admin.catalogo', 'admin.comunidade', 'admin.conformidade', 'admin.conteudo',
  'admin.painel', 'admin.plataforma', 'admin.usuarios', 'admin.seguranca',
  'sistema.seguranca',
];

async function principal() {
  await garantirBanco();
  sequelizeCli('db:migrate');
  if (await precisaSeed()) sequelizeCli('db:seed:all');

  const pedidas = process.argv.slice(2);
  const alvos = (pedidas.length ? pedidas : SUITES).map((n) => n.replace(/\.test\.js$/, ''));

  console.log(`\n[testar] banco: ${bancoTeste} | cache: ${process.env.REDIS_PREFIXO}\n`);

  const falhas = [];
  for (const nome of alvos) {
    const arquivo = path.join(RAIZ, 'testes', `${nome}.test.js`);
    if (!fs.existsSync(arquivo)) {
      console.error(`[testar] suíte inexistente: ${nome}`);
      falhas.push(nome);
      continue;
    }
    console.log(`\n──────── ${nome} ────────`);
    const r = spawnSync(process.execPath, [arquivo], { cwd: RAIZ, env: ambiente, stdio: 'inherit' });
    if (r.status !== 0) falhas.push(nome);
  }

  console.log(`\n[testar] ${alvos.length - falhas.length}/${alvos.length} suítes passaram`);
  if (falhas.length) {
    console.log(`[testar] falharam: ${falhas.join(', ')}`);
    process.exit(1);
  }
}

principal().catch((erro) => {
  console.error('[testar] erro:', erro.message);
  process.exit(1);
});
