'use strict';

const path = require('path');
const express = require('express');

const RAIZ = path.resolve(__dirname, '..');

/**
 * Apoio das suítes de favorito e contato.
 *
 * **Por que uma app própria em vez de `require('../app')`:** os routers destes
 * dois módulos ainda não estão montados em `src/routes/index.js`, e aquele
 * arquivo é proibido de editar enquanto os módulos são escritos em paralelo
 * (padrão §15). A app daqui monta a mesma pilha do `app.js` — contexto,
 * rotas, handler de erro — para que o teste continue exercitando o
 * comportamento visto pela rede, incluindo os códigos de status que o
 * middleware de erro traduz.
 *
 * Quando o orquestrador registrar os routers, este arquivo pode sumir e os
 * testes passam a apontar para a app real sem mudar mais nada.
 */
function montarApp(caminho, router) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(require(RAIZ + '/src/middlewares').contexto);
  app.use(caminho, router);
  app.use((req, res) =>
    res.status(404).json({ sucesso: false, erro: { codigo: 'ROTA_NAO_ENCONTRADA' } })
  );
  app.use(require(RAIZ + '/src/middlewares').erro);
  return app;
}

/** cliente HTTP mínimo, no mesmo formato de `auth.fluxo.test.js` */
function cliente(base) {
  return async (metodo, caminho, corpo, token) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const texto = await r.text();
    return { status: r.status, corpo: texto ? JSON.parse(texto) : null };
  };
}

/**
 * Cria uma conta real pelo service de registro do auth e devolve token.
 *
 * Passa pelo service e não por INSERT direto porque é ele que atribui o papel
 * `usuario` e cria o perfil — sem isso o RBAC do teste não teria permissão
 * nenhuma e todo 403 seria falso positivo.
 */
async function criarUsuario(sufixo, extras = {}) {
  const db = require(RAIZ + '/src/models');
  const registroService = require(RAIZ + '/src/features/auth/auth.registro.service');
  const loginService = require(RAIZ + '/src/features/auth/auth.login.service');

  const email = `t${sufixo}@agropecas.dev`;
  const senha = 'SenhaForte123';
  const ctx = { ipHash: 'f'.repeat(64), userAgent: 'teste', origem: 'web' };

  await registroService.criar(
    {
      nome: `Teste ${sufixo}`,
      email,
      senha,
      tipoPerfil: 'loja',
      nomeExibicao: `Loja ${sufixo}`,
      whatsapp: '+5565999991234',
      consentimentos: [
        { tipo: 'termos_de_uso', aceito: true },
        { tipo: 'politica_privacidade', aceito: true },
      ],
      ...extras,
    },
    ctx
  );

  const { usuario, tokens } = await loginService.entrar({ email, senha }, ctx);
  const perfil = await db.Perfil.findOne({ where: { usuario_id: usuario.id } });

  return { usuario, perfil, token: tokens.acesso, email, senha };
}

/** anúncio publicado e pronto para receber favorito e contato */
async function criarAnuncio(usuario, perfil, sufixo) {
  const db = require(RAIZ + '/src/models');
  const titulo = `Bomba injetora teste ${sufixo}`;

  return db.Anuncio.create({
    /* `codigo` é único no banco e 11 agentes rodam contra a mesma base:
       aleatório é o que evita colisão entre suítes concorrentes */
    codigo: `AGP${require('crypto').randomBytes(4).toString('hex').toUpperCase()}`,
    usuario_id: usuario.id,
    perfil_id: perfil.id,
    tipo: 'peca',
    titulo,
    titulo_normalizado: titulo.toLowerCase(),
    slug: `bomba-injetora-teste-${sufixo}`,
    descricao: 'Peça de teste automatizado. Não é anúncio real.',
    preco_centavos: 250000,
    status: 'publicado',
    publicado_em: new Date(),
  });
}

const ok = (nome, cond, extra) =>
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));

module.exports = { RAIZ, montarApp, cliente, criarUsuario, criarAnuncio, ok };
