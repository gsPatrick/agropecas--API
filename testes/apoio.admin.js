'use strict';

const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const { Router } = require('express');
const middlewares = require(RAIZ + '/src/middlewares');
const db = require(RAIZ + '/src/models');

/**
 * Apoio das suítes do painel administrativo.
 *
 * Existe por um motivo temporário e documentado: `admin.routes.js` importa os
 * sete controllers do painel, e três deles (comunidade, plataforma,
 * conformidade) ainda não foram entregues pelos outros agentes — requerer o
 * router hoje falha antes de registrar qualquer rota. Além disso, a linha
 * `router.use('/v1/admin', ...)` continua comentada em `src/routes/index.js`,
 * que é arquivo proibido para este módulo.
 *
 * As rotas abaixo são **cópia literal** das linhas correspondentes de
 * `admin.routes.js`: mesmos middlewares, mesma ordem, mesmos esquemas. Quando
 * o painel inteiro existir, este arquivo deixa de ser necessário e as suítes
 * passam a montar `require('../src/features/admin/admin.routes')`.
 */

function rotasDaFatia() {
  const { autenticar, autorizar, validar, rateLimit } = middlewares;
  const conteudo = require(RAIZ + '/src/features/admin/controllers/admin.conteudo.controller');
  const catalogo = require(RAIZ + '/src/features/admin/controllers/admin.catalogo.controller');
  const esquemas = require(RAIZ + '/src/features/admin/admin.validators');

  const router = Router();
  router.use(autenticar, autorizar('admin.acessar'));

  // ─── CONTEÚDO: ANÚNCIOS E MODERAÇÃO ────────────────────────────
  router.get('/anuncios', autorizar('anuncio.ler'), validar.query(esquemas.listarAnuncios), conteudo.listar);
  router.get('/anuncios/:id', autorizar('anuncio.ler'), validar.params(esquemas.identificador), conteudo.ver);
  router.patch('/anuncios/:id', rateLimit.escrita(), autorizar('anuncio.editar'), validar.params(esquemas.identificador), validar(esquemas.editarAnuncio), conteudo.editar);
  router.delete('/anuncios/:id', rateLimit.escrita(), autorizar('anuncio.remover'), validar.params(esquemas.identificador), validar(esquemas.motivo), conteudo.remover);

  router.get('/moderacao/fila', autorizar('anuncio.ler'), validar.query(esquemas.filaModeracao), conteudo.fila);
  router.post('/anuncios/:id/aprovar', rateLimit.escrita(), autorizar('anuncio.aprovar'), validar.params(esquemas.identificador), validar(esquemas.motivoOpcional), conteudo.aprovar);
  router.post('/anuncios/:id/reprovar', rateLimit.escrita(), autorizar('anuncio.reprovar'), validar.params(esquemas.identificador), validar(esquemas.motivo), conteudo.reprovar);
  router.post('/anuncios/:id/ocultar', rateLimit.escrita(), autorizar('anuncio.ocultar'), validar.params(esquemas.identificador), validar(esquemas.motivo), conteudo.ocultar);
  router.post('/anuncios/:id/destacar', rateLimit.escrita(), autorizar('anuncio.destacar'), validar.params(esquemas.identificador), validar(esquemas.destaque), conteudo.destacar);

  router.post('/anuncios/em-nome-de', rateLimit.escrita(), autorizar('anuncio.criar_em_nome_de'), validar(esquemas.anuncioEmNomeDe), conteudo.criarEmNomeDe);
  router.post('/anuncios/lote/moderar', rateLimit.escrita(), autorizar('anuncio.aprovar'), validar(esquemas.loteModeracao), conteudo.moderarEmLote);

  router.post('/fotos/:id/bloquear', rateLimit.escrita(), autorizar('anuncio_foto.bloquear'), validar.params(esquemas.identificador), validar(esquemas.motivo), conteudo.bloquearFoto);
  router.get('/midia', autorizar('arquivo.remover'), validar.query(esquemas.listagem), conteudo.listarMidia);
  router.delete('/midia/:id', rateLimit.escrita(), autorizar('arquivo.remover'), validar.params(esquemas.identificador), validar(esquemas.motivo), conteudo.removerMidia);

  // ─── CATÁLOGO ──────────────────────────────────────────────────
  router.get('/catalogo/:colecao', autorizar('categoria.criar'), validar.params(esquemas.colecao), validar.query(esquemas.listagem), catalogo.listar);
  router.post('/catalogo/:colecao', rateLimit.escrita(), validar.params(esquemas.colecao), validar(esquemas.itemCatalogo), catalogo.criar);
  router.patch('/catalogo/:colecao/:id', rateLimit.escrita(), validar.params(esquemas.colecaoItem), validar(esquemas.itemCatalogo), catalogo.editar);
  router.delete('/catalogo/:colecao/:id', rateLimit.escrita(), validar.params(esquemas.colecaoItem), catalogo.remover);
  router.patch('/catalogo/:colecao/ordenar', rateLimit.escrita(), validar.params(esquemas.colecao), validar(esquemas.ordenacao), catalogo.ordenar);

  return router;
}

/** app equivalente ao de `app.js` no que importa: contexto, rotas, erro */
function montarApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(middlewares.contexto);
  app.use('/api/v1/auth', require(RAIZ + '/src/features/auth/auth.routes'));
  app.use('/api/v1/admin', rotasDaFatia());
  app.use((req, res) =>
    res.status(404).json({ sucesso: false, erro: { codigo: 'ROTA_NAO_ENCONTRADA' } })
  );
  app.use(middlewares.erro);
  return app;
}

/** cliente HTTP mínimo — o mesmo formato das outras suítes */
const clienteEm = (base) => async (metodo, caminho, corpo, token) => {
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

const SENHA = 'SenhaForte123';

/**
 * Registra uma conta nova.
 * O sufixo com timestamp é obrigatório: e-mail e slug são únicos no banco, e
 * um valor fixo faria a suíte passar só na primeira execução.
 */
async function registrar(req, marca) {
  const email = `admtest.${marca}.${Date.now()}${Math.floor(Math.random() * 1000)}@agropecas.dev`;
  const r = await req('POST', '/auth/registrar', {
    nome: `Fulano ${marca}`,
    email,
    senha: SENHA,
    tipoPerfil: 'produtor',
    nomeExibicao: `Fazenda ${marca} ${Date.now()}`,
    aceiteTermos: true,
    aceitePrivacidade: true,
  });
  if (r.status !== 201) throw new Error('falha ao registrar: ' + JSON.stringify(r.corpo));
  return { email, token: r.corpo.dados.tokens.acesso, id: r.corpo.dados.usuario.id };
}

/**
 * Vincula um papel e reentra.
 * O token carrega as permissões da hora do login: sem reentrar, o papel novo
 * não vale para a sessão que já existe.
 */
async function comPapel(req, conta, papelId) {
  await db.UsuarioPapel.create({ usuario_id: conta.id, papel_id: papelId });
  const r = await req('POST', '/auth/entrar', { email: conta.email, senha: SENHA });
  return r.corpo.dados.tokens.acesso;
}

const papelPorChave = async (chave) => {
  const papel = await db.Papel.findOne({ where: { chave } });
  if (!papel) throw new Error(`papel "${chave}" não existe — rode npm run rbac:sync`);
  return papel;
};

module.exports = { montarApp, clienteEm, registrar, comPapel, papelPorChave, SENHA, RAIZ };
