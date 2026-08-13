'use strict';

/**
 * Painel administrativo — resumo, pendências, métricas, atividade e saúde.
 *
 * Roda contra a API e o banco de verdade, como as demais suítes: o que
 * interessa aqui é o que o front e um curioso veem pela rede, não o retorno de
 * uma função isolada.
 *
 *   node testes/admin.painel.test.js
 *
 * NOTA DE MONTAGEM: `src/routes/index.js` ainda não monta `/v1/admin` (a linha
 * está comentada porque outros controllers do módulo estão sendo escritos em
 * paralelo, e o arquivo é proibido para os agentes). A suíte sobe um app
 * próprio com a MESMA pilha de middlewares do `app.js` e a mesma ordem de
 * `admin.routes.js`. Quando o roteador oficial passar a carregar, o teste usa
 * ele — a tentativa está no `montarAdmin()` abaixo.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const { limparLimites, encerrarInfra } = require('./apoio');
const app = require(RAIZ + '/app');
const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');

const { autenticar, autorizar, validar } = middlewares;
const { somenteAdmin } = require(RAIZ + '/src/middlewares/autorizar');

let servidorAuth;
let servidorAdmin;
let baseAuth;
let baseAdmin;

const req = async (base, metodo, caminho, corpo, token) => {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

const auth = (metodo, caminho, corpo, token) => req(baseAuth, metodo, caminho, corpo, token);
const admin = (metodo, caminho, corpo, token) => req(baseAdmin, metodo, caminho, corpo, token);

/** CNPJ válido e distinto a cada execução: documento é único no banco */
function cnpjValido() {
  const base = Array.from({ length: 12 }, (_, i) => (i < 8 ? Math.floor(Math.random() * 10) : [0, 0, 0, 1][i - 8]));
  const dv = (nums) => {
    let peso = nums.length - 7;
    let soma = 0;
    for (let i = 0; i < nums.length; i++) {
      soma += nums[i] * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

let contador = 0;
async function criarConta(rotulo) {
  contador += 1;
  const email = `admin-painel-${Date.now()}-${contador}@agropecas.dev`;

  const r = await auth('POST', '/registrar', {
    nome: `Conta ${rotulo} Teste`,
    email,
    senha: 'SenhaForte123',
    tipoPerfil: 'loja',
    nomeExibicao: `Loja ${rotulo} ${Date.now()}${contador}`,
    documento: cnpjValido(),
    razaoSocial: `Loja ${rotulo} LTDA`,
    aceiteTermos: true,
    aceitePrivacidade: true,
  });

  if (r.status !== 201) throw new Error(`falha ao criar conta ${rotulo}: ${JSON.stringify(r.corpo)}`);

  return { email, id: r.corpo.dados.usuario.id, token: r.corpo.dados.tokens.acesso };
}

/** vincula o papel e refaz o login: as permissões são lidas do banco por requisição */
async function comPapel(conta, chave) {
  const papel = await db.Papel.findOne({ where: { chave } });
  await db.UsuarioPapel.create({ usuario_id: conta.id, papel_id: papel.id });

  const r = await auth('POST', '/entrar', { email: conta.email, senha: 'SenhaForte123' });
  return { ...conta, token: r.corpo.dados.tokens.acesso };
}

/**
 * Roteador do painel para o teste.
 *
 * Tenta o roteador oficial; se ele ainda não carrega (controller de outro
 * agente ausente), monta as rotas desta fatia com os mesmos middlewares e na
 * mesma ordem do contrato. O objetivo é testar o comportamento pela rede sem
 * depender de um módulo que ainda está sendo escrito.
 */
function montarAdmin() {
  try {
    return { router: require(RAIZ + '/src/features/admin/admin.routes'), oficial: true };
  } catch (erro) {
    const painel = require(RAIZ + '/src/features/admin/controllers/admin.painel.controller');
    const esquemas = require(RAIZ + '/src/features/admin/admin.validators');

    const router = express.Router();
    router.use(autenticar, autorizar('admin.acessar'));

    router.get('/painel', painel.resumo);
    router.get('/painel/pendencias', painel.pendencias);
    router.get('/painel/metricas', validar.query(esquemas.periodo), painel.metricas);
    router.get('/painel/atividade', validar.query(esquemas.listagem), painel.atividade);
    router.get('/painel/saude', somenteAdmin, painel.saude);

    return { router, oficial: false, motivo: erro.message };
  }
}

const resultados = { ok: 0, falhas: 0 };
const ok = (nome, cond, extra) => {
  resultados[cond ? 'ok' : 'falhas'] += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

(async () => {
  await limparLimites();

  servidorAuth = app.listen(0);
  baseAuth = 'http://127.0.0.1:' + servidorAuth.address().port + '/api/v1/auth';

  const { router, oficial, motivo } = montarAdmin();
  console.log(oficial ? '\n(roteador oficial de admin)' : `\n(roteador local — admin.routes.js ainda não carrega: ${motivo})`);

  const appAdmin = express();
  appAdmin.use(express.json());
  appAdmin.use(middlewares.contexto);
  appAdmin.use('/api/v1/admin', router);
  appAdmin.use(middlewares.erro);

  servidorAdmin = appAdmin.listen(0);
  baseAdmin = 'http://127.0.0.1:' + servidorAdmin.address().port + '/api/v1/admin';

  const comum = await criarConta('comum');
  const contaAdmin = await comPapel(await criarConta('admin'), 'admin');
  const moderador = await comPapel(await criarConta('moderador'), 'moderador');

  console.log('\n— quem entra no painel —');
  let r = await admin('GET', '/painel');
  ok('sem token → 401', r.status === 401, r.corpo);

  r = await admin('GET', '/painel', null, comum.token);
  ok('usuário comum → 403', r.status === 403, r.corpo);

  r = await admin('GET', '/painel', null, contaAdmin.token);
  ok('admin → 200', r.status === 200, r.corpo);
  ok('resumo traz contadores de usuário', typeof r.corpo?.dados?.contadores?.usuariosNovos === 'number', r.corpo?.dados);
  ok('resumo traz o dia', /^\d{4}-\d{2}-\d{2}$/.test(r.corpo?.dados?.dia || ''), r.corpo?.dados);
  ok('admin vê o card de planos', typeof r.corpo?.dados?.contadores?.assinaturasAtivas === 'number', r.corpo?.dados?.contadores);

  r = await admin('GET', '/painel', null, moderador.token);
  ok('moderador entra no painel → 200', r.status === 200, r.corpo);
  ok('moderador vê denúncias', typeof r.corpo?.dados?.contadores?.denunciasAbertas === 'number', r.corpo?.dados?.contadores);
  ok(
    'moderador NÃO vê o card de planos',
    r.corpo?.dados?.contadores?.assinaturasAtivas === undefined,
    r.corpo?.dados?.contadores
  );

  console.log('\n— pendências —');
  r = await admin('GET', '/painel/pendencias', null, contaAdmin.token);
  ok('pendências → 200', r.status === 200, r.corpo);
  ok('pendências vem como lista', Array.isArray(r.corpo?.dados), r.corpo);
  const ordenado = (r.corpo?.dados || []).every(
    (item, i, lista) => i === 0 || lista[i - 1].prioridade >= item.prioridade
  );
  ok('pendências vêm priorizadas', ordenado, r.corpo?.dados?.slice(0, 3));

  r = await admin('GET', '/painel/pendencias', null, comum.token);
  ok('pendências para usuário comum → 403', r.status === 403, r.corpo);

  console.log('\n— métricas —');
  const hoje = new Date().toISOString().slice(0, 10);
  const trintaDias = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  r = await admin('GET', `/painel/metricas?de=${trintaDias}&ate=${hoje}`, null, contaAdmin.token);
  ok('métricas → 200', r.status === 200, r.corpo);
  ok('série diária de cadastros', Array.isArray(r.corpo?.dados?.usuarios?.porDia), r.corpo?.dados?.usuarios);
  ok('período ecoa o recorte pedido', r.corpo?.dados?.periodo?.ate === hoje, r.corpo?.dados?.periodo);

  const antigo = new Date(Date.now() - 500 * 86400000).toISOString().slice(0, 10);
  r = await admin('GET', `/painel/metricas?de=${antigo}&ate=${hoje}`, null, contaAdmin.token);
  ok('período acima do teto → 400', r.status === 400, r.corpo);

  console.log('\n— atividade administrativa —');
  r = await admin('GET', '/painel/atividade', null, contaAdmin.token);
  ok('atividade → 200 paginado', r.status === 200 && Array.isArray(r.corpo?.dados), r.corpo);
  ok('meta de paginação presente', typeof r.corpo?.meta?.total === 'number', r.corpo?.meta);
  ok(
    'atividade não expõe ip_hash',
    !JSON.stringify(r.corpo || {}).includes('ip_hash') && !JSON.stringify(r.corpo || {}).includes('ipHash'),
    r.corpo?.dados?.[0]
  );

  r = await admin('GET', '/painel/atividade?porPagina=9999', null, contaAdmin.token);
  ok('porPagina acima do teto → 422 na validação', r.status === 422, r.corpo);

  console.log('\n— saúde —');
  r = await admin('GET', '/painel/saude', null, contaAdmin.token);
  ok('saúde para admin → 200', r.status === 200, r.corpo);
  ok('reporta o banco', r.corpo?.dados?.banco?.ok === true, r.corpo?.dados?.banco);
  ok('reporta o motor de cache', typeof r.corpo?.dados?.cache?.motor === 'string', r.corpo?.dados?.cache);
  ok('reporta as filas', r.corpo?.dados?.filas !== undefined, r.corpo?.dados);

  r = await admin('GET', '/painel/saude', null, moderador.token);
  ok('saúde para moderador → 403 (infra é só do admin)', r.status === 403, r.corpo);

  r = await admin('GET', '/painel/saude', null, comum.token);
  ok('saúde para usuário comum → 403', r.status === 403, r.corpo);

  console.log(`\n— total: ${resultados.ok} ok, ${resultados.falhas} falha(s) —`);

  servidorAuth.close();
  servidorAdmin.close();
  await encerrarInfra();
  await db.sequelize.close();
  process.exit(resultados.falhas ? 1 : 0);
})().catch(async (erro) => {
  console.error('\nERRO NA SUÍTE:', erro);
  try {
    servidorAuth?.close();
    servidorAdmin?.close();
    await encerrarInfra();
    await db.sequelize.close();
  } catch (_) {
    /* encerramento é melhor esforço */
  }
  process.exit(1);
});
