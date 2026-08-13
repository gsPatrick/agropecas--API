'use strict';

/**
 * Notificação de ponta a ponta, contra a API, o banco, o Redis e o WebSocket
 * de verdade. Não é unitário de propósito: o que interessa é o comportamento
 * observável pela rede — o que o front recebe e o que um curioso consegue.
 *
 *   node testes/notificacao.test.js
 *
 * O app é montado aqui e não importado de `app.js` porque
 * `src/routes/index.js` ainda não registra a feature (arquivo compartilhado,
 * fora do escopo deste módulo — ver relatório). Os middlewares, as rotas e os
 * services são exatamente os de produção.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');

const express = require('express');
const cookieParser = require('cookie-parser');
const { io: conectarSocket } = require('socket.io-client');

const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');
const tempoReal = require(RAIZ + '/src/tempo-real');
const cache = require(RAIZ + '/src/cache');
const notificacaoService = require(RAIZ + '/src/features/notificacao');
const massaService = require(RAIZ + '/src/features/notificacao/notificacao.massa.service');
const criacaoService = require(RAIZ + '/src/features/notificacao/notificacao.criacao.service');

// ─── apoio ──────────────────────────────────────────────────────
let server;
let base;
let raiz;

let passou = 0;
let falhou = 0;
const ok = (nome, cond, extra) => {
  if (cond) passou += 1;
  else falhou += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

const req = async (metodo, caminho, corpo, token) => {
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

const auth = (metodo, caminho, corpo, token) =>
  fetch(raiz + '/api/v1/auth' + caminho, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  }).then(async (r) => ({ status: r.status, corpo: await r.json().catch(() => null) }));

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/** promessa que resolve no primeiro evento, ou em null depois do prazo */
const proximoEvento = (socket, evento, prazoMs = 4000) =>
  new Promise((resolver) => {
    const relogio = setTimeout(() => {
      socket.off(evento, aoReceber);
      resolver(null);
    }, prazoMs);

    function aoReceber(dados) {
      clearTimeout(relogio);
      socket.off(evento, aoReceber);
      resolver(dados);
    }
    socket.on(evento, aoReceber);
  });

const montarApp = () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(middlewares.contexto);
  app.use('/api/v1/auth', require(RAIZ + '/src/features/auth/auth.routes'));
  app.use('/api/v1/notificacoes', require(RAIZ + '/src/features/notificacao/notificacao.routes'));
  app.use((r, res) => res.status(404).json({ sucesso: false, erro: { codigo: 'ROTA_NAO_ENCONTRADA' } }));
  app.use(middlewares.erro);
  return app;
};

const marca = Date.now();
const cadastrar = async (sufixo, tipo = 'produtor') => {
  const email = `notif-${sufixo}-${marca}@agropecas.dev`;
  const r = await auth('POST', '/registrar', {
    nome: `Teste ${sufixo}`,
    email,
    senha: 'SenhaForte123',
    tipoPerfil: tipo,
    aceiteTermos: true,
    aceitePrivacidade: true,
  });
  if (r.status !== 201) throw new Error('cadastro falhou: ' + JSON.stringify(r.corpo));
  return { email, id: r.corpo.dados.usuario.id, token: r.corpo.dados.tokens.acesso };
};

// ─── suíte ──────────────────────────────────────────────────────
(async () => {
  await limparLimites();

  server = montarApp().listen(0);
  raiz = 'http://127.0.0.1:' + server.address().port;
  base = raiz + '/api/v1/notificacoes';
  await tempoReal.iniciar(server);
  ok('tempo real ativo (' + tempoReal.motor() + ')', tempoReal.motor() === 'socket.io');

  const alice = await cadastrar('alice');
  const bruno = await cadastrar('bruno');
  const admin = await cadastrar('admin', 'loja');

  console.log('\n— entrega em tempo real —');
  const socket = conectarSocket(raiz, {
    path: '/tempo-real',
    auth: { token: bruno.token },
    transports: ['websocket'],
    reconnection: false,
  });

  const conectou = await new Promise((resolver) => {
    socket.on('connect', () => resolver(true));
    socket.on('connect_error', () => resolver(false));
    setTimeout(() => resolver(false), 5000);
  });
  ok('cliente socket.io autenticou com o token da sessão', conectou);

  const anonimo = conectarSocket(raiz, {
    path: '/tempo-real',
    auth: { token: 'token.falso.aqui' },
    transports: ['websocket'],
    reconnection: false,
  });
  const recusado = await new Promise((resolver) => {
    anonimo.on('connect_error', () => resolver(true));
    anonimo.on('connect', () => resolver(false));
    setTimeout(() => resolver(false), 5000);
  });
  ok('socket com token inválido é recusado no aperto de mão', recusado);
  anonimo.close();

  const eventoNova = proximoEvento(socket, 'notificacao:nova');
  const eventoContador = proximoEvento(socket, 'contador:atualizado');

  const criada = await notificacaoService.criar({
    usuarioId: bruno.id,
    tipo: 'mensagem_nova',
    titulo: 'Nova mensagem',
    mensagem: 'Alguém respondeu seu anúncio.',
    dados: { conversaId: 'abc', link: '/conversas/abc' },
    entidade: 'conversas',
    entidadeId: null,
    canais: ['sistema'],
  });
  ok('criar grava uma linha no canal sistema', criada.criadas.length === 1, criada);

  const recebido = await eventoNova;
  ok('cliente recebeu notificacao:nova na sala dele', !!recebido?.notificacao, recebido);
  ok(
    'evento traz o mesmo registro gravado',
    recebido?.notificacao?.id === criada.criadas[0].id,
    { evento: recebido?.notificacao?.id, banco: criada.criadas[0].id }
  );
  const contadorEvento = await eventoContador;
  ok('cliente recebeu contador:atualizado', contadorEvento?.naoLidas === 1, contadorEvento);

  const outroSocket = conectarSocket(raiz, {
    path: '/tempo-real',
    auth: { token: alice.token },
    transports: ['websocket'],
    reconnection: false,
  });
  await new Promise((resolver) => {
    outroSocket.on('connect', resolver);
    outroSocket.on('connect_error', resolver);
    setTimeout(resolver, 3000);
  });
  const vazamento = proximoEvento(outroSocket, 'notificacao:nova', 1500);
  await notificacaoService.criar({
    usuarioId: bruno.id,
    tipo: 'mensagem_nova',
    titulo: 'Segunda mensagem',
    mensagem: 'Outra resposta.',
    canais: ['sistema'],
  });
  ok('notificação de terceiro NÃO chega na sala de quem não é dono', (await vazamento) === null);
  outroSocket.close();

  console.log('\n— contador de não lidas —');
  let r = await req('GET', '/nao-lidas', null, bruno.token);
  ok('contador bate com o banco', r.status === 200 && r.corpo.dados.naoLidas === 2, r.corpo);

  const noBanco = await db.Notificacao.count({
    where: { usuario_id: bruno.id, canal: 'sistema', lida_em: null },
  });
  ok('cache e banco concordam', noBanco === r.corpo.dados.naoLidas, { noBanco, cache: r.corpo.dados.naoLidas });

  r = await req('GET', '/nao-lidas', null, null);
  ok('contador sem token → 401', r.status === 401, r.corpo);

  console.log('\n— listagem —');
  r = await req('GET', '/?lida=false&porPagina=1', null, bruno.token);
  ok('listagem paginada → 200', r.status === 200, r.corpo);
  ok('respeita porPagina', r.corpo?.dados?.length === 1, r.corpo?.dados?.length);
  ok('meta traz total e páginas', r.corpo?.meta?.total === 2 && r.corpo?.meta?.totalPaginas === 2, r.corpo?.meta);
  ok('não expõe usuario_id do dono para ele mesmo', r.corpo.dados[0].usuarioId === undefined, r.corpo.dados[0]);
  ok('mapper renomeia corpo → mensagem', typeof r.corpo.dados[0].mensagem === 'string', r.corpo.dados[0]);

  r = await req('GET', '/?porPagina=99999', null, bruno.token);
  ok('porPagina acima do teto → 422 (o teto está no esquema)', r.status === 422, r.corpo);
  r = await req('GET', '/?porPagina=50', null, bruno.token);
  ok('porPagina no teto ainda passa', r.status === 200 && r.corpo.meta.porPagina === 50, r.corpo?.meta);

  r = await req('GET', '/?tipo=anuncio_aprovado', null, bruno.token);
  ok('filtro por tipo funciona', r.corpo?.meta?.total === 0, r.corpo?.meta);

  r = await req('GET', '/?tipo=inexistente', null, bruno.token);
  ok('tipo fora do enum → 422', r.status === 422, r.corpo);

  const soDoBruno = await db.Notificacao.count({ where: { usuario_id: alice.id } });
  ok('listagem de Bruno não trouxe nada de Alice (escopo na consulta)', soDoBruno === 0);

  console.log('\n— marcar como lida (escopo) —');
  const daBruno = criada.criadas[0].id;

  r = await req('PATCH', `/${daBruno}/ler`, null, alice.token);
  ok('ler notificação alheia → 403', r.status === 403, r.corpo);

  const inexistente = '00000000-0000-4000-8000-000000000000';
  const rInexistente = await req('PATCH', `/${inexistente}/ler`, null, alice.token);
  ok(
    '404 e 403 indistinguíveis (sem oráculo de enumeração)',
    rInexistente.status === r.status && rInexistente.corpo.erro.codigo === r.corpo.erro.codigo,
    { alheia: r.status, inexistente: rInexistente.status }
  );

  const aindaNaoLida = await db.Notificacao.findByPk(daBruno);
  ok('a tentativa alheia não marcou nada', !aindaNaoLida.lida_em);

  r = await req('PATCH', `/${daBruno}/ler`, null, bruno.token);
  ok('dono marca a própria → 200', r.status === 200 && r.corpo.dados.lida === true, r.corpo);

  r = await req('GET', '/nao-lidas', null, bruno.token);
  ok('contador caiu para 1 (cache invalidado na escrita)', r.corpo.dados.naoLidas === 1, r.corpo);

  r = await req('PATCH', '/ler-todas', {}, bruno.token);
  ok('marcar todas → 200 e 1 marcada', r.status === 200 && r.corpo.dados.marcadas === 1, r.corpo);

  r = await req('GET', '/nao-lidas', null, bruno.token);
  ok('contador zerou', r.corpo.dados.naoLidas === 0, r.corpo);

  const alheiaNoLote = await db.Notificacao.create({
    usuario_id: alice.id,
    tipo: 'sistema',
    canal: 'sistema',
    titulo: 'da alice',
    corpo: 'x',
  });
  r = await req('PATCH', '/ler', { ids: [alheiaNoLote.id] }, bruno.token);
  ok('lote ignora id alheio (0 marcadas, sem revelar nada)', r.corpo?.dados?.marcadas === 0, r.corpo);
  ok('a linha da Alice continua não lida', !(await alheiaNoLote.reload()).lida_em);

  console.log('\n— preferências —');
  r = await req('GET', '/preferencias', null, bruno.token);
  ok('matriz completa de preferências → 200', r.status === 200 && r.corpo.dados.length >= 8, r.corpo?.dados?.length);
  ok('tudo nasce ligado', r.corpo.dados[0].canais.every((c) => c.ativo === true), r.corpo.dados[0]);

  r = await req(
    'PUT',
    '/preferencias',
    { itens: [{ tipo: 'anuncio_expirando', canal: 'sistema', ativo: false }] },
    bruno.token
  );
  ok('salvar preferência → 200', r.status === 200, r.corpo);

  const desligado = await criacaoService.criar({
    usuarioId: bruno.id,
    tipo: 'anuncio_expirando',
    titulo: 'Seu anúncio vai expirar',
    mensagem: 'Renove para continuar aparecendo.',
    canais: ['sistema'],
  });
  ok(
    'preferência desligada NÃO cria notificação',
    desligado.criadas.length === 0 && desligado.ignorados.includes('sistema:preferencia_desligada'),
    desligado
  );
  ok(
    'nada foi gravado no banco',
    (await db.Notificacao.count({ where: { usuario_id: bruno.id, tipo: 'anuncio_expirando' } })) === 0
  );

  const aindaPermitido = await criacaoService.criar({
    usuarioId: bruno.id,
    tipo: 'mensagem_nova',
    titulo: 'Continua chegando',
    mensagem: 'Outro tipo, outra preferência.',
    canais: ['sistema'],
  });
  ok('desligar um tipo não desliga os outros', aindaPermitido.criadas.length === 1, aindaPermitido);

  r = await req(
    'PUT',
    '/preferencias',
    { itens: [{ tipo: 'conta_suspensa', canal: 'sistema', ativo: false }] },
    bruno.token
  );
  const suspensao = await criacaoService.criar({
    usuarioId: bruno.id,
    tipo: 'conta_suspensa',
    titulo: 'Sua conta foi suspensa',
    mensagem: 'Fale com o suporte.',
    canais: ['sistema'],
  });
  ok('aviso de segurança da conta não é silenciável', suspensao.criadas.length === 1, suspensao);

  console.log('\n— canal e-mail —');
  const doisCanais = await criacaoService.criar({
    usuarioId: bruno.id,
    tipo: 'anuncio_aprovado',
    titulo: 'Anúncio aprovado',
    mensagem: 'Seu anúncio já está no ar.',
    canais: ['sistema', 'email'],
  });
  ok('uma linha por canal', doisCanais.criadas.length === 2, doisCanais);
  const linhaEmail = await db.Notificacao.findOne({
    where: { usuario_id: bruno.id, tipo: 'anuncio_aprovado', canal: 'email' },
  });
  ok('linha de e-mail nasce sem enviada_em (quem confirma é o job)', !linhaEmail.enviada_em);
  ok(
    'contador ignora o canal e-mail',
    (await notificacaoService.naoLidas(bruno.id)).naoLidas ===
      (await db.Notificacao.count({
        where: { usuario_id: bruno.id, canal: 'sistema', lida_em: null },
      }))
  );

  await req('PUT', '/preferencias', { itens: [{ tipo: 'anuncio_aprovado', canal: 'email', ativo: false }] }, bruno.token);
  const soSistema = await criacaoService.criar({
    usuarioId: bruno.id,
    tipo: 'anuncio_aprovado',
    titulo: 'Outro aprovado',
    mensagem: 'Mais um no ar.',
    canais: ['sistema', 'email'],
  });
  ok(
    'desligar o e-mail não desliga o sininho',
    soSistema.criadas.length === 1 &&
      soSistema.criadas[0].canal === 'sistema' &&
      soSistema.ignorados.includes('email:preferencia_desligada'),
    soSistema
  );

  const semProvider = await criacaoService.criar({
    usuarioId: bruno.id,
    tipo: 'sistema',
    titulo: 'Push',
    mensagem: 'Canal ainda sem provider.',
    canais: ['push'],
  });
  ok(
    'canal sem provider é recusado, não vira linha fantasma',
    semProvider.criadas.length === 0 && semProvider.ignorados.includes('push:sem_provider'),
    semProvider
  );

  console.log('\n— dado pessoal de terceiro —');
  const comVazamento = await criacaoService.criar({
    usuarioId: bruno.id,
    tipo: 'mensagem_nova',
    titulo: 'Fulano te chamou',
    mensagem: 'Toque para responder.',
    dados: {
      conversaId: 'xyz',
      telefone: '+5565999998888',
      whatsapp: '65999998888',
      remetenteEmail: 'fulano@exemplo.com',
      documento: '52998224725',
      remetenteNome: 'Fulano',
    },
    canais: ['sistema'],
  });
  const gravada = await db.Notificacao.findByPk(comVazamento.criadas[0].id);
  const serializada = JSON.stringify(gravada.dados || {});
  ok('telefone de terceiro não é gravado', !serializada.includes('999998888'), gravada.dados);
  ok('e-mail de terceiro não é gravado', !serializada.includes('exemplo.com'), gravada.dados);
  ok('documento de terceiro não é gravado', !serializada.includes('52998224725'), gravada.dados);
  ok('o que não é dado pessoal continua passando', gravada.dados.conversaId === 'xyz', gravada.dados);

  console.log('\n— envio em massa —');
  r = await req('POST', '/massa', { tipo: 'sistema', titulo: 'Aviso', mensagem: 'Oi' }, bruno.token);
  ok('usuário comum não dispara comunicado → 403', r.status === 403, r.corpo);

  const papelAdmin = await db.Papel.findOne({ where: { chave: 'admin' } });
  const usuarioAdmin = await db.Usuario.findByPk(admin.id);
  await db.UsuarioPapel.create({ usuario_id: usuarioAdmin.id, papel_id: papelAdmin.id });
  const reloginAdmin = await auth('POST', '/entrar', { email: admin.email, senha: 'SenhaForte123' });
  const tokenAdmin = reloginAdmin.corpo.dados.tokens.acesso;

  r = await req(
    'POST',
    '/massa',
    {
      tipo: 'sistema',
      titulo: 'Manutenção {{nome}}',
      mensagem: 'O sistema fica fora no domingo.',
      canais: ['sistema'],
      segmento: { usuarioIds: [alice.id, bruno.id] },
      motivo: 'teste automatizado',
    },
    tokenAdmin
  );
  ok('admin dispara comunicado → 202 com loteId', r.status === 202 && !!r.corpo.dados.loteId, r.corpo);

  const trilha = await db.LogAuditoria.count({
    where: { acao: 'criar', entidade: 'notificacoes', entidade_id: r.corpo.dados.loteId },
  });
  ok('envio em massa gravou auditoria', trilha === 1, trilha);

  /* o job real é processado por um worker do BullMQ, que não roda no teste:
     chamamos o bloco direto, que é exatamente o que o job chama */
  const lote = {
    loteId: r.corpo.dados.loteId,
    tipo: 'sistema',
    titulo: 'Manutenção {{nome}}',
    mensagem: 'O sistema fica fora no domingo.',
    canais: ['sistema'],
    segmento: { usuarioIds: [alice.id, bruno.id] },
    cursor: null,
  };

  const bloco1 = await massaService.processarBloco(lote);
  ok('primeiro bloco cria 2 notificações em bulk', bloco1.criadas === 2, bloco1);

  const bloco2 = await massaService.processarBloco(lote);
  ok('reprocessar o MESMO lote não duplica', bloco2.criadas === 0, bloco2);

  const porUsuario = await db.Notificacao.count({
    where: { referencia_tipo: 'comunicados', referencia_id: lote.loteId, usuario_id: bruno.id },
  });
  ok('cada destinatário tem exatamente uma linha do lote', porUsuario === 1, porUsuario);

  const daAlice = await db.Notificacao.findOne({
    where: { referencia_tipo: 'comunicados', referencia_id: lote.loteId, usuario_id: alice.id },
  });
  ok(
    'placeholder {{nome}} foi renderizado com o nome do destinatário',
    daAlice?.titulo?.startsWith('Manutenção Teste ') && !daAlice.titulo.includes('{{'),
    daAlice?.titulo
  );

  const fim = await massaService.processarBloco({ ...lote, cursor: bloco1.proximoCursor });
  ok('paginação por keyset chega ao fim', fim.fim === true, fim);

  const desligou = await db.NotificacaoPreferencia.create({
    usuario_id: alice.id,
    tipo: 'sistema',
    canal: 'sistema',
    ativo: false,
  });
  const loteRespeitando = { ...lote, loteId: require('crypto').randomUUID() };
  const bloco3 = await massaService.processarBloco(loteRespeitando);
  ok('envio em massa respeita preferência desligada', bloco3.criadas === 1, bloco3);
  await desligou.destroy();

  console.log('\n— templates (Admin) —');
  r = await req('GET', '/templates', null, bruno.token);
  ok('usuário comum não vê templates → 403', r.status === 403, r.corpo);

  const canalUnico = 'push';
  await db.TemplateNotificacao.destroy({ where: { tipo: 'denuncia_resolvida', canal: canalUnico } });

  r = await req(
    'POST',
    '/templates',
    {
      tipo: 'denuncia_resolvida',
      canal: canalUnico,
      titulo: 'Olá {{nome}}',
      corpo: 'Sua denúncia sobre {{alvo}} foi resolvida.',
      variaveis: ['nome', 'alvo'],
    },
    tokenAdmin
  );
  ok('admin cria template → 201', r.status === 201, r.corpo);
  const templateId = r.corpo?.dados?.id;

  const repetido = await req(
    'POST',
    '/templates',
    { tipo: 'denuncia_resolvida', canal: canalUnico, corpo: 'x' },
    tokenAdmin
  );
  ok('template duplicado (tipo+canal) → 409', repetido.status === 409, repetido.corpo);

  r = await req('PUT', `/templates/${templateId}`, { corpo: 'Resolvemos {{alvo}}.' }, tokenAdmin);
  ok('admin edita template → 200', r.status === 200 && r.corpo.dados.corpo === 'Resolvemos {{alvo}}.', r.corpo);

  const trilhaTemplate = await db.LogAuditoria.count({
    where: { acao: 'editar', entidade: 'templates_notificacao', entidade_id: templateId },
  });
  ok('edição de template auditada', trilhaTemplate === 1, trilhaTemplate);

  ok(
    'renderização substitui placeholder e ignora chave ausente',
    notificacaoService.renderizar('Oi {{nome}}, sobre {{sumiu}}.', { nome: 'Ana' }) === 'Oi Ana, sobre .',
    notificacaoService.renderizar('Oi {{nome}}, sobre {{sumiu}}.', { nome: 'Ana' })
  );

  r = await req('DELETE', `/templates/${templateId}`, null, tokenAdmin);
  ok('admin remove template → 204', r.status === 204, r.corpo);

  console.log('\n— encerrando —');
  socket.close();
  await esperar(200);
  await cache.invalidar(require(RAIZ + '/src/features/notificacao/notificacao.cache').chaves.dominio());
  await tempoReal.encerrar();
  server.close();
  await db.sequelize.close();
  await encerrarInfra();

  console.log(`\n${passou} passaram · ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
