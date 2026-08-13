'use strict';

/**
 * Entrada da aplicação.
 * Só isto vive aqui: env, Express, middlewares globais, montagem de rotas,
 * handler de erro e listen. Qualquer regra de negócio vive em src/.
 */

/* o .env é carregado por src/config — a fronteira do ambiente é lá */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { execSync } = require('child_process');
const config = require('./src/config');
const routes = require('./src/routes');
const middlewares = require('./src/middlewares');
const redis = require('./src/providers/redis');
const filas = require('./src/filas');
const tempoReal = require('./src/tempo-real');
const { sequelize } = require('./src/models');

const app = express();

/* atrás de proxy (Nginx/Render) o IP real vem no X-Forwarded-For; sem isto o
   rate-limit veria todo mundo como o mesmo cliente */
app.set('trust proxy', 1);
app.disable('x-powered-by');

/**
 * Cabeçalhos de segurança.
 *
 * A API devolve JSON, não HTML, então `contentSecurityPolicy` e
 * `crossOriginEmbedderPolicy` só atrapalhariam o consumo pelo front sem
 * proteger nada aqui — quem precisa de CSP é a aplicação Next.
 *
 * O que importa neste processo: HSTS, `nosniff` (impede o navegador de tratar
 * uma resposta JSON como script) e `Referrer-Policy` (evita que a URL da API,
 * com id de anúncio e filtros, vaze para terceiros).
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: config.app.env === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);

app.use(
  cors({
    origin: config.seguranca.corsOrigens,
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* monta req.contexto antes de qualquer rota: middlewares e services contam
   com ele existindo, mesmo para visitante */
app.use(middlewares.contexto);

app.use(config.app.apiPrefix, routes);

// 404 — nenhuma rota atendeu
app.use((req, res) => {
  res.status(404).json({
    sucesso: false,
    erro: { codigo: 'ROTA_NAO_ENCONTRADA', mensagem: 'Recurso não encontrado.' },
    requisicaoId: req.contexto?.requisicaoId,
  });
});

// handler de erro único do projeto
app.use(middlewares.erro);

/**
 * Migração e seed automáticos no boot.
 *
 * Existem para que subir um container novo (EasyPanel, ou qualquer deploy
 * sem acesso a shell) já deixe o banco no estado certo, sem passo manual.
 * `sequelize-cli` é idempotente pelas tabelas `SequelizeMeta`/`SequelizeData`
 * — rodar de novo em cada boot não reaplica o que já foi aplicado.
 */
async function migrarEPopular() {
  console.log('[db] rodando migrations...');
  execSync('npx sequelize-cli db:migrate', { stdio: 'inherit' });

  console.log('[db] rodando seeds...');
  execSync('npx sequelize-cli db:seed:all', { stdio: 'inherit' });
}

async function iniciar() {
  try {
    await sequelize.authenticate();
    console.log('[db] conexão estabelecida');
  } catch (erro) {
    console.error('[db] falha ao conectar:', erro.message);
    if (config.app.env === 'production') process.exit(1);
  }

  try {
    await migrarEPopular();
  } catch (erro) {
    console.error('[db] falha ao migrar/popular:', erro.message);
    if (config.app.env === 'production') process.exit(1);
  }

  /* Redis é opcional: sem ele, cache cai para memória e job roda na hora.
     O aviso existe para que isso seja escolha, não descoberta em produção */
  redis.conectar();
  filas.conferirAmbiente();

  const servidor = app.listen(config.app.port, () => {
    console.log(`[api] ouvindo em http://localhost:${config.app.port}${config.app.apiPrefix}`);
  });

  /* o WebSocket compartilha o mesmo servidor HTTP: porta separada exigiria
     outra entrada no balanceador e outro certificado, sem ganho nenhum */
  await tempoReal.iniciar(servidor);

  /* encerramento limpo: sem isto, um deploy corta requisição no meio e deixa
     conexão de banco e Redis pendurada até o timeout do orquestrador */
  const encerrar = async (sinal) => {
    console.log(`\n[api] ${sinal} recebido, encerrando...`);
    servidor.close();
    await tempoReal.encerrar().catch(() => null);
    await filas.encerrar().catch(() => null);
    await redis.encerrar().catch(() => null);
    await sequelize.close().catch(() => null);
    process.exit(0);
  };

  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

if (require.main === module) iniciar();

module.exports = app;
