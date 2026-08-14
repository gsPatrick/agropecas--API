'use strict';

/**
 * Entrada da aplicação.
 * Só isto vive aqui: env, Express, middlewares globais, montagem de rotas,
 * handler de erro e listen. Qualquer regra de negócio vive em src/.
 */

/* o .env é carregado por src/config — a fronteira do ambiente é lá */
const path = require('path');
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
    /* CORS_ORIGENS=* libera qualquer origem — `true` faz o pacote refletir o
       Origin da requisição; `'*'` literal quebraria com `credentials: true`,
       que o cookie de sessão exige */
    origin: config.seguranca.corsOrigens.includes('*') ? true : config.seguranca.corsOrigens,
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/**
 * Serve os arquivos enviados (`STORAGE_DRIVER=local`) no mesmo caminho que
 * `src/providers/storage/index.js` já monta a URL pública
 * (`STORAGE_PUBLIC_URL + '/' + caminho`) — sem isto, toda foto de anúncio ou
 * de perfil tinha URL válida no banco mas 404 de verdade no navegador,
 * porque nada aqui respondia por `/uploads`. Fica de fora do driver de nuvem
 * (S3/R2), que serve direto do provedor.
 */
if (config.storage.driver === 'local') {
  app.use('/uploads', express.static(path.resolve(config.storage.localPath)));
}

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

/**
 * Bootstrap de admin — promove e-mails de `ADMIN_BOOTSTRAP_EMAILS` (lista
 * separada por vírgula) ao papel `admin`, se a conta já existir.
 *
 * Existe porque não há endpoint de API para isto (autopromoção seria uma
 * falha de segurança) e este ambiente não tem acesso direto ao Postgres —
 * então o boot vira o único lugar disponível para conceder o primeiro admin.
 * `findOrCreate` na tabela usa o índice único (usuario_id, papel_id), então
 * rodar de novo em todo boot não duplica nem escreve à toa.
 */
async function promoverAdminsBootstrap() {
  const emails = (process.env.ADMIN_BOOTSTRAP_EMAILS || 'admin.teste@agropecasmt.dev')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (!emails.length) return;

  const db = require('./src/models');
  const papelAdmin = await db.Papel.findOne({ where: { chave: 'admin' } });
  if (!papelAdmin) {
    console.warn('[admin-bootstrap] papel "admin" não encontrado — RBAC ainda não foi sincronizado?');
    return;
  }

  for (const email of emails) {
    const usuario = await db.Usuario.findOne({ where: { email_normalizado: email } });
    if (!usuario) continue;

    const [, criado] = await db.UsuarioPapel.findOrCreate({
      where: { usuario_id: usuario.id, papel_id: papelAdmin.id },
      defaults: { usuario_id: usuario.id, papel_id: papelAdmin.id },
    });

    if (criado) console.log(`[admin-bootstrap] ${email} promovido a admin`);
  }
}

/**
 * Conta demo com perfil vazio de propósito — para o assistente de primeiro
 * acesso (onboarding) do front disparar assim que alguém logar com ela.
 *
 * Chama o próprio `POST /auth/registrar` via loopback em vez de tocar o
 * banco direto: é o mesmo caminho que qualquer cadastro real passa
 * (hash de senha, consentimentos, criação do perfil), então a conta nasce
 * exatamente como a de um usuário de verdade nasceria — sem outro cadastro
 * "de mentira" que a `auth.registro.service` não reconheceria depois.
 * 409 (e-mail já cadastrado) é o caminho normal a partir do segundo boot.
 */
async function criarContaDemoBootstrap() {
  const email = (process.env.DEMO_ONBOARDING_EMAIL || 'novo.teste@agropecasmt.dev').toLowerCase();
  const url = `http://127.0.0.1:${config.app.port}${config.app.apiPrefix}/v1/auth/registrar`;

  const resposta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: 'Novo Produtor',
      email,
      senha: 'AgroPecas#2026',
      tipoPerfil: 'produtor',
      aceiteTermos: true,
      aceitePrivacidade: true,
    }),
  });

  const corpo = await resposta.json().catch(() => null);

  if (resposta.status === 409) {
    console.log(`[demo-bootstrap] ${email} já existe`);
    return;
  }

  if (!resposta.ok) {
    console.warn(`[demo-bootstrap] falha ao criar ${email}:`, corpo?.erro?.mensagem || resposta.status);
    return;
  }

  console.log(`[demo-bootstrap] ${email} criado — perfil vazio, onboarding dispara no primeiro login`);
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

  try {
    await promoverAdminsBootstrap();
  } catch (erro) {
    console.error('[admin-bootstrap] falha:', erro.message);
  }

  /* Redis é opcional: sem ele, cache cai para memória e job roda na hora.
     O aviso existe para que isso seja escolha, não descoberta em produção */
  redis.conectar();
  filas.conferirAmbiente();

  const servidor = app.listen(config.app.port, () => {
    console.log(`[api] ouvindo em http://localhost:${config.app.port}${config.app.apiPrefix}`);
    criarContaDemoBootstrap().catch((erro) => console.warn('[demo-bootstrap] falha:', erro.message));
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
