'use strict';

/**
 * Entrada da aplicação.
 * Só isto vive aqui: env, Express, middlewares globais, montagem de rotas,
 * handler de erro e listen. Qualquer regra de negócio vive em src/.
 */

/* o .env é carregado por src/config — a fronteira do ambiente é lá */
const path = require('path');
const fs = require('fs/promises');
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

/**
 * Consumo de fila embutido no processo web — quando não há um segundo
 * serviço rodando `worker.js`.
 *
 * `worker.js` foi desenhado para subir SEPARADO da API (ver o comentário no
 * topo daquele arquivo): job pesado não deve competir por CPU com quem
 * espera uma tela carregar, e os dois escalam independente. Isso pressupõe
 * dois serviços no EasyPanel — um rodando `node app.js`, outro `node worker.js`.
 *
 * Só existe um hoje. Com Redis conectado (visto nos logs de boot), toda
 * escrita que passa por fila — visualização de anúncio, expiração automática,
 * limpeza de sessão — cai no BullMQ e fica esperando um consumidor que nunca
 * chega: a contagem de "Visualizações" travava em zero para sempre, mesmo
 * com contato registrado (que é síncrono, por isso aparecia normalmente).
 *
 * A correção de fundo é configurar o segundo serviço; até lá, este processo
 * consome a própria fila — mesma chamada que `worker.js` faz, só que aqui
 * dentro. `WORKER_EMBUTIDO=false` desliga isto no dia em que o segundo
 * serviço existir, para não processar o mesmo job em dois lugares.
 */
async function iniciarFilaEmbutida() {
  if (process.env.WORKER_EMBUTIDO === 'false') return;
  if (!config.redis.url) return; /* sem Redis, `filas/index.js` já roda tudo na hora */

  const bullmq = require('./src/filas/adaptadores/bullmq');
  const total = bullmq.iniciarTrabalhadores();
  console.log(`[fila-embutida] ${total} fila(s) em consumo neste processo`);

  /* mesma espera de `worker.js`: `redis.conectar()` não bloqueia até o
     cliente ficar pronto, e `filas.agendar()` decide o adaptador olhando
     `redis.disponivel()` — chamado cedo demais, cairia no adaptador
     "imediato" e nenhuma rotina periódica seria agendada de verdade */
  await new Promise((resolver) => setTimeout(resolver, 500));

  const PERIODICOS = [
    { trabalho: 'manutencao.limparSessoes', cron: '0 3 * * *' },
    { trabalho: 'manutencao.limparTokens', cron: '15 3 * * *' },
    { trabalho: 'manutencao.desbloquearContas', cron: '*/10 * * * *' },
    { trabalho: 'midia.limparOrfaos', cron: '30 3 * * *' },
    { trabalho: 'busca.agregarTermosPopulares', cron: '5 * * * *' },
    { trabalho: 'anuncio.expirar', cron: '20 * * * *' },
  ];

  for (const periodico of PERIODICOS) {
    await filas.agendar(periodico.trabalho, {}, { cron: periodico.cron });
  }
  console.log(`[fila-embutida] ${PERIODICOS.length} rotina(s) periódica(s) agendada(s)`);
}

/**
 * Vitrine de demonstração — um produtor com perfil completo e 3 anúncios
 * publicados, com foto, para a cliente ver a plataforma funcionando de
 * verdade em vez de uma tela vazia.
 *
 * Tudo passa pelo próprio HTTP da API (loopback), nunca por escrita direta no
 * banco — mesmo motivo do `criarContaDemoBootstrap`: nasce pelo caminho real
 * (hash de senha, validação, moderação, processamento de imagem), então é
 * indistinguível de uma conta e um anúncio publicados por uma pessoa.
 *
 * Idempotente por checagem, não por `findOrCreate`: loga primeiro; se a conta
 * já existe E já tem anúncio, não faz nada. Assim um redeploy não duplica os
 * 3 anúncios a cada boot.
 */
async function criarVitrineDemoBootstrap() {
  const base = `http://127.0.0.1:${config.app.port}${config.app.apiPrefix}/v1`;
  const email = 'demo.produtor@agropecasmt.dev';
  const senha = 'AgroPecas#2026';

  const chamar = (caminho, opcoes = {}) =>
    fetch(`${base}${caminho}`, opcoes).then(async (resposta) => ({
      ok: resposta.ok,
      status: resposta.status,
      corpo: await resposta.json().catch(() => null),
    }));

  let { ok, corpo } = await chamar('/auth/entrar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });

  if (!ok) {
    const municipio = await chamar(
      `/localizacao/municipios?uf=MT&busca=${encodeURIComponent('Cuiabá')}&porPagina=1`
    );
    const municipioId = municipio.corpo?.dados?.[0]?.id;

    const registro = await chamar('/auth/registrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Carlos Mendes',
        email,
        senha,
        tipoPerfil: 'produtor',
        documento: '88687816464',
        whatsapp: '+5565999998888',
        telefone: '+5565999998888',
        propriedadeNome: 'Fazenda Modelo',
        municipioId,
        aceiteTermos: true,
        aceitePrivacidade: true,
      }),
    });

    if (!registro.ok) {
      console.warn('[vitrine-demo] falha ao registrar:', registro.corpo?.erro?.mensagem || registro.status);
      return;
    }

    ({ ok, corpo } = registro);
  }

  const token = corpo?.dados?.tokens?.acesso;
  if (!token) {
    console.warn('[vitrine-demo] sem token de acesso, abortando');
    return;
  }

  const autorizado = { Authorization: `Bearer ${token}` };

  const meusAnuncios = await chamar('/anuncios/meus?porPagina=1', { headers: autorizado });
  if ((meusAnuncios.corpo?.meta?.total || 0) > 0) {
    console.log(`[vitrine-demo] ${email} já tem anúncio — nada a fazer`);
    return;
  }

  await chamar('/perfis/meu', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...autorizado },
    body: JSON.stringify({
      bio: 'Produtor rural em Cuiabá/MT. Vendo peças e máquinas seminovas de reposição, direto da fazenda.',
      areaHectares: 850,
      culturas: ['Soja', 'Milho'],
    }),
  });

  const categorias = await chamar('/catalogo/categorias?tipo=peca&porPagina=5');
  const categoriaId =
    categorias.corpo?.dados?.[0]?.filhas?.[0]?.id || categorias.corpo?.dados?.[0]?.id;

  const municipioAtual = await chamar(
    `/localizacao/municipios?uf=MT&busca=${encodeURIComponent('Cuiabá')}&porPagina=1`
  );
  const municipioId = municipioAtual.corpo?.dados?.[0]?.id;

  const PRODUTOS = [
    {
      arquivo: 'peca1.jpg',
      titulo: 'Filtro de ar John Deere 6110J original',
      descricao: 'Filtro de ar original, pouco uso, retirado de máquina em manutenção preventiva.',
      condicao: 'usada',
      precoCentavos: 25000,
    },
    {
      arquivo: 'peca2.jpg',
      titulo: 'Kit de embreagem para trator Massey Ferguson',
      descricao: 'Kit completo novo, lacrado, com nota fiscal.',
      condicao: 'nova',
      precoCentavos: 180000,
    },
    {
      arquivo: 'peca3.jpg',
      titulo: 'Jogo de rolamentos para colheitadeira',
      descricao: 'Jogo completo, compatível com as principais marcas. Pronta entrega.',
      condicao: 'nova',
      precoCentavos: 42000,
    },
  ];

  for (const produto of PRODUTOS) {
    const criado = await chamar('/anuncios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...autorizado },
      body: JSON.stringify({
        titulo: produto.titulo,
        descricao: produto.descricao,
        tipo: 'peca',
        categoriaId,
        condicao: produto.condicao,
        negociacao: 'venda',
        precoCentavos: produto.precoCentavos,
        quantidade: 1,
        municipioId,
        uf: 'MT',
      }),
    });

    if (!criado.ok) {
      console.warn(`[vitrine-demo] falha ao criar "${produto.titulo}":`, criado.corpo?.erro?.mensagem);
      continue;
    }

    const anuncioId = criado.corpo.dados.id;

    const caminhoImagem = path.join(__dirname, 'seed-assets', produto.arquivo);
    const buffer = await fs.readFile(caminhoImagem);
    const formData = new FormData();
    formData.append('arquivo', new Blob([buffer], { type: 'image/jpeg' }), produto.arquivo);
    formData.append('referenciaTipo', 'anuncio');

    const upload = await fetch(`${base}/midia`, { method: 'POST', headers: autorizado, body: formData });
    const uploadCorpo = await upload.json().catch(() => null);
    const fotoId = uploadCorpo?.dados?.[0]?.id;

    if (fotoId) {
      await chamar(`/anuncios/${anuncioId}/fotos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...autorizado },
        body: JSON.stringify({ arquivos: [fotoId] }),
      });
    }

    await chamar(`/anuncios/${anuncioId}/publicar`, { method: 'POST', headers: autorizado });

    console.log(`[vitrine-demo] anúncio publicado: ${produto.titulo}`);
  }

  console.log(`[vitrine-demo] conta pronta — ${email} / ${senha}`);
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

  try {
    await iniciarFilaEmbutida();
  } catch (erro) {
    console.error('[fila-embutida] falha ao iniciar:', erro.message);
  }

  const servidor = app.listen(config.app.port, () => {
    console.log(`[api] ouvindo em http://localhost:${config.app.port}${config.app.apiPrefix}`);
    criarContaDemoBootstrap().catch((erro) => console.warn('[demo-bootstrap] falha:', erro.message));
    criarVitrineDemoBootstrap().catch((erro) => console.warn('[vitrine-demo] falha:', erro.message));
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
