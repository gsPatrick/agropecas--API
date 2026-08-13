'use strict';

/**
 * Chat de ponta a ponta, contra a API, o banco e o WebSocket de verdade.
 *
 * Não é unitário de propósito: o que interessa é o comportamento observável
 * pela rede — que é o que o front e um atacante veem.
 *
 *   node testes/conversa.test.js
 *
 * O router de conversas ainda não está montado em `src/routes/index.js` (linha
 * comentada, arquivo que este módulo não pode editar). Para não depender disso,
 * a suíte monta um app próprio com os MESMOS middlewares globais do `app.js` e
 * os dois routers que usa.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');
const express = require('express');
const cookieParser = require('cookie-parser');
const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');
const tempoReal = require(RAIZ + '/src/tempo-real');
const { io: clienteSocket } = require('socket.io-client');

const marca = Date.now();
let servidor;
let base;

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

let falhas = 0;
const ok = (nome, cond, extra) => {
  if (!cond) falhas += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

function cnpjValido() {
  const inicio = Array.from({ length: 12 }, (_, i) =>
    i < 8 ? Math.floor(Math.random() * 10) : [0, 0, 0, 1][i - 8]
  );
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
  const d1 = dv(inicio);
  const d2 = dv([...inicio, d1]);
  return [...inicio, d1, d2].join('');
}

/** cria conta pela API real de auth: o token precisa ser legítimo */
async function criarUsuario(rotulo, tipoPerfil = 'loja') {
  const email = `conv-${rotulo}-${marca}@agropecas.dev`;
  const r = await req(
    'POST',
    '/auth/registrar',
    {
      nome: `Conversa ${rotulo} ${marca}`,
      email,
      senha: 'SenhaForte123',
      tipoPerfil,
      nomeExibicao: `Conversa ${rotulo} ${marca}`,
      documento: cnpjValido(),
      razaoSocial: `Conversa ${rotulo} LTDA`,
      aceiteTermos: true,
      aceitePrivacidade: true,
    },
    null
  );

  if (r.status !== 201) throw new Error('falha ao criar usuário de teste: ' + JSON.stringify(r.corpo));
  return { email, token: r.corpo.dados.tokens.acesso, id: r.corpo.dados.usuario.id };
}

/** anúncio direto no banco: o módulo de anúncio ainda não existe */
async function criarAnuncio(usuarioId, sufixo) {
  const perfil = await db.Perfil.findOne({ where: { usuario_id: usuarioId } });
  return db.Anuncio.create({
    codigo: `T${String(marca).slice(-6)}${sufixo}`,
    usuario_id: usuarioId,
    perfil_id: perfil.id,
    tipo: 'peca',
    titulo: `Bomba injetora teste ${marca}${sufixo}`,
    titulo_normalizado: `bomba injetora teste ${marca}${sufixo}`,
    slug: `bomba-injetora-teste-${marca}${sufixo}`,
    descricao: 'Peça de teste automatizado.',
    /* `ck_anuncios_preco_ou_combinar`: ou tem preço, ou é a combinar */
    preco_centavos: 150000,
    status: 'publicado',
    publicado_em: new Date(),
  });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await limparLimites();

  /* app de teste: mesmos middlewares globais do app.js */
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(middlewares.contexto);
  app.use('/api/v1/auth', require(RAIZ + '/src/features/auth/auth.routes'));
  app.use('/api/v1/conversas', require(RAIZ + '/src/features/conversa/conversa.routes'));
  app.use(middlewares.erro);

  servidor = app.listen(0);
  const porta = servidor.address().port;
  base = 'http://127.0.0.1:' + porta + '/api/v1';

  await tempoReal.iniciar(servidor);

  console.log('\n— preparação —');
  const anunciante = await criarUsuario('anunciante');
  const interessado = await criarUsuario('interessado');
  const terceiro = await criarUsuario('terceiro', 'produtor');
  const anuncio = await criarAnuncio(anunciante.id, 'A');
  ok('três contas e um anúncio criados', Boolean(anuncio.id));

  console.log('\n— início de conversa —');
  let r = await req('POST', '/conversas', { anuncioId: anuncio.id }, interessado.token);
  ok('inicia a partir do anúncio → 201', r.status === 201, r.corpo);
  const conversaId = r.corpo?.dados?.id;
  ok('conversa vinculada ao anúncio', r.corpo?.dados?.anuncio?.id === anuncio.id, r.corpo?.dados?.anuncio);

  r = await req('POST', '/conversas', { anuncioId: anuncio.id }, interessado.token);
  ok('iniciar duas vezes devolve A MESMA conversa', r.status === 200 && r.corpo?.dados?.id === conversaId, r.corpo?.dados?.id);
  const totalConversas = await db.Conversa.count({ where: { anuncio_id: anuncio.id } });
  ok('não criou linha duplicada no banco', totalConversas === 1, totalConversas);

  r = await req('POST', '/conversas', { anuncioId: anuncio.id }, anunciante.token);
  ok('não conversa com o próprio anúncio → 400', r.status === 400, r.corpo);

  r = await req('POST', '/conversas', { anuncioId: anuncio.id });
  ok('sem login não conversa → 401', r.status === 401, r.corpo);

  r = await req('POST', '/conversas', { anuncioId: 'nao-e-uuid' }, interessado.token);
  ok('validação de entrada → 422', r.status === 422, r.corpo);

  console.log('\n— acesso de terceiro —');
  r = await req('GET', '/conversas/' + conversaId, null, terceiro.token);
  ok('terceiro não lê a conversa → 404 (não 403)', r.status === 404, r.corpo);
  r = await req('GET', '/conversas/' + conversaId + '/mensagens', null, terceiro.token);
  ok('terceiro não pagina mensagens → 404', r.status === 404, r.corpo);
  r = await req('POST', '/conversas/' + conversaId + '/mensagens', { conteudo: 'oi' }, terceiro.token);
  ok('terceiro não envia → 404', r.status === 404, r.corpo);
  const inexistente = await req('GET', '/conversas/' + require('crypto').randomUUID(), null, terceiro.token);
  ok('conversa alheia e inexistente respondem igual', inexistente.status === 404 && inexistente.corpo?.erro?.codigo === r.corpo?.erro?.codigo, {
    alheia: r.corpo?.erro?.codigo,
    inexistente: inexistente.corpo?.erro?.codigo,
  });

  console.log('\n— tempo real —');
  const socket = clienteSocket('http://127.0.0.1:' + porta, {
    path: '/tempo-real',
    auth: { token: anunciante.token },
    transports: ['websocket'],
  });

  await new Promise((resolver, rejeitar) => {
    socket.on('connect', resolver);
    socket.on('connect_error', rejeitar);
    setTimeout(() => rejeitar(new Error('timeout de conexão')), 5000);
  });
  ok('anunciante conecta no WebSocket', socket.connected);

  const entrada = await new Promise((resolver) =>
    socket.emit('conversa:entrar', conversaId, resolver)
  );
  ok('participante entra na sala da conversa', entrada?.ok === true, entrada);

  const salaAlheia = await new Promise((resolver) => {
    const alheio = clienteSocket('http://127.0.0.1:' + porta, {
      path: '/tempo-real',
      auth: { token: terceiro.token },
      transports: ['websocket'],
    });
    alheio.on('connect', () => alheio.emit('conversa:entrar', conversaId, (resposta) => {
      alheio.close();
      resolver(resposta);
    }));
  });
  ok('terceiro não entra na sala → SEM_ACESSO', salaAlheia?.ok === false, salaAlheia);

  const recebida = new Promise((resolver) => socket.on('mensagem:nova', resolver));

  console.log('\n— envio de mensagem —');
  r = await req('POST', '/conversas/' + conversaId + '/mensagens', { conteudo: 'Bom dia, a peça ainda está disponível?' }, interessado.token);
  ok('envia → 201', r.status === 201, r.corpo);
  const mensagemId = r.corpo?.dados?.id;

  const evento = await Promise.race([recebida, esperar(4000).then(() => null)]);
  ok('MENSAGEM_NOVA entregue em tempo real', evento?.mensagem?.id === mensagemId, evento);
  ok('evento traz a conversa e o conteúdo', evento?.conversaId === conversaId && evento?.mensagem?.conteudo?.includes('disponível'), evento);

  r = await req('POST', '/conversas/' + conversaId + '/mensagens', { conteudo: '   ' }, interessado.token);
  ok('mensagem vazia → 422', r.status === 422, r.corpo);
  r = await req('POST', '/conversas/' + conversaId + '/mensagens', { conteudo: 'x'.repeat(2500) }, interessado.token);
  ok('mensagem acima do teto → 422', r.status === 422, r.corpo);

  console.log('\n— contador de não lidas —');
  await req('POST', '/conversas/' + conversaId + '/mensagens', { conteudo: 'Segunda pergunta.' }, interessado.token);

  let participanteAnunciante = await db.ConversaParticipante.findOne({
    where: { conversa_id: conversaId, usuario_id: anunciante.id },
  });
  ok('contador do destinatário é 2', participanteAnunciante.nao_lidas === 2, participanteAnunciante.nao_lidas);

  const participanteInteressado = await db.ConversaParticipante.findOne({
    where: { conversa_id: conversaId, usuario_id: interessado.id },
  });
  ok('quem enviou fica com 0', participanteInteressado.nao_lidas === 0, participanteInteressado.nao_lidas);

  r = await req('GET', '/conversas', null, anunciante.token);
  ok('caixa de entrada lista a conversa', r.status === 200 && r.corpo.dados.length >= 1, r.corpo);
  const item = r.corpo.dados.find((c) => c.id === conversaId);
  ok('lista traz contador e prévia sem consulta extra', item?.naoLidas === 2 && item?.ultimaMensagem?.previa === 'Segunda pergunta.', item);
  ok('lista traz a outra parte e o anúncio', item?.outraParte?.id === interessado.id && item?.anuncio?.id === anuncio.id, item);
  ok('lista não vaza dado interno da outra parte', !JSON.stringify(item).includes('senha_hash') && !JSON.stringify(item).includes('documento'), item);

  r = await req('GET', '/conversas/nao-lidas', null, anunciante.token);
  ok('balão global soma a coluna', r.corpo?.dados?.total >= 2, r.corpo);

  r = await req('POST', '/conversas/' + conversaId + '/ler', null, anunciante.token);
  ok('marcar como lida → 200 com 0', r.status === 200 && r.corpo.dados.naoLidas === 0, r.corpo);
  participanteAnunciante = await db.ConversaParticipante.findOne({
    where: { conversa_id: conversaId, usuario_id: anunciante.id },
  });
  ok('contador zerado no banco', participanteAnunciante.nao_lidas === 0, participanteAnunciante.nao_lidas);

  console.log('\n— paginação por cursor —');
  for (let i = 0; i < 5; i++) {
    await req('POST', '/conversas/' + conversaId + '/mensagens', { conteudo: 'lote ' + i }, interessado.token);
  }
  r = await req('GET', '/conversas/' + conversaId + '/mensagens?limite=3', null, anunciante.token);
  ok('primeira página respeita o limite', r.status === 200 && r.corpo.dados.length === 3, r.corpo?.dados?.length);
  ok('mais recente primeiro', r.corpo.dados[0].conteudo === 'lote 4', r.corpo.dados[0]);
  const cursor = r.corpo.meta.proximoCursor;
  ok('devolve cursor opaco', typeof cursor === 'string' && cursor.length > 0, cursor);

  /* uma mensagem nova entra ENTRE as páginas: com offset, a próxima página
     repetiria/pularia registro. O cursor aponta para a linha, não a posição */
  await req('POST', '/conversas/' + conversaId + '/mensagens', { conteudo: 'intrusa' }, interessado.token);
  const pagina2 = await req('GET', '/conversas/' + conversaId + '/mensagens?limite=3&antesDe=' + encodeURIComponent(cursor), null, anunciante.token);
  const conteudos = pagina2.corpo.dados.map((m) => m.conteudo);
  ok('página 2 continua de onde parou, apesar da mensagem nova', conteudos[0] === 'lote 1' && !conteudos.includes('intrusa'), conteudos);

  console.log('\n— remoção de mensagem —');
  r = await req('DELETE', '/conversas/mensagens/' + mensagemId, { motivo: 'engano' }, anunciante.token);
  ok('não remove mensagem de outro → 403', r.status === 403, r.corpo);
  r = await req('DELETE', '/conversas/mensagens/' + mensagemId, { motivo: 'engano' }, interessado.token);
  ok('remove a própria → 200', r.status === 200, r.corpo);
  const noBanco = await db.Mensagem.findByPk(mensagemId);
  ok('soft delete: registro permanece', Boolean(noBanco) && Boolean(noBanco.removida_em), noBanco?.removida_em);
  r = await req('GET', '/conversas/' + conversaId + '/mensagens?limite=100', null, anunciante.token);
  const removida = r.corpo.dados.find((m) => m.id === mensagemId);
  ok('conteúdo não sai mais na API', removida?.removida === true && removida?.conteudo === 'Mensagem removida.', removida);
  const auditado = await db.LogAuditoria.count({ where: { entidade: 'mensagens', entidade_id: mensagemId } });
  ok('remoção gravou auditoria', auditado > 0, auditado);

  console.log('\n— bloqueio —');
  r = await req('POST', '/conversas/bloqueios', { usuarioId: interessado.id, motivo: 'spam' }, anunciante.token);
  ok('bloqueia → 201', r.status === 201, r.corpo);
  r = await req('POST', '/conversas/bloqueios', { usuarioId: anunciante.id }, anunciante.token);
  ok('não bloqueia a si mesmo → 400', r.status === 400, r.corpo);

  r = await req('POST', '/conversas/' + conversaId + '/mensagens', { conteudo: 'ainda posso falar?' }, interessado.token);
  ok('BLOQUEADO não envia → 403', r.status === 403, r.corpo);
  r = await req('POST', '/conversas/' + conversaId + '/mensagens', { conteudo: 'e no outro sentido?' }, anunciante.token);
  ok('bloqueio vale nos dois sentidos', r.status === 403, r.corpo);

  const anuncio2 = await criarAnuncio(anunciante.id, 'B');
  r = await req('POST', '/conversas', { anuncioId: anuncio2.id }, interessado.token);
  ok('bloqueado não inicia conversa nova → 403', r.status === 403, r.corpo);

  r = await req('GET', '/conversas/bloqueios', null, anunciante.token);
  ok('lista os próprios bloqueios', r.status === 200 && r.corpo.dados.some((b) => b.usuarioId === interessado.id), r.corpo);
  const auditoriaBloqueio = await db.LogAuditoria.count({ where: { entidade: 'bloqueios_usuario' } });
  ok('bloqueio gravou auditoria', auditoriaBloqueio > 0, auditoriaBloqueio);

  r = await req('DELETE', '/conversas/bloqueios/' + interessado.id, null, anunciante.token);
  ok('desbloqueia → 200', r.status === 200 && r.corpo.dados.desbloqueado === true, r.corpo);
  r = await req('POST', '/conversas/' + conversaId + '/mensagens', { conteudo: 'voltamos' }, interessado.token);
  ok('volta a enviar depois do desbloqueio', r.status === 201, r.corpo);

  console.log('\n— aceita_chat = false —');
  await db.Perfil.update({ aceita_chat: false }, { where: { usuario_id: anunciante.id } });
  const anuncio3 = await criarAnuncio(anunciante.id, 'C');
  r = await req('POST', '/conversas', { anuncioId: anuncio3.id }, terceiro.token);
  ok('aceita_chat=false impede início → 403', r.status === 403 && r.corpo?.erro?.detalhe?.motivo === 'CHAT_DESATIVADO', r.corpo);
  r = await req('POST', '/conversas/' + conversaId + '/mensagens', { conteudo: 'a thread antiga segue' }, interessado.token);
  ok('conversa já aberta continua respondível', r.status === 201, r.corpo);
  await db.Perfil.update({ aceita_chat: true }, { where: { usuario_id: anunciante.id } });

  console.log('\n— arquivar e encerrar —');
  r = await req('POST', '/conversas/' + conversaId + '/arquivar', null, anunciante.token);
  ok('arquiva → 200', r.status === 200, r.corpo);
  r = await req('GET', '/conversas', null, anunciante.token);
  ok('some da caixa de entrada padrão', !r.corpo.dados.some((c) => c.id === conversaId), r.corpo.dados.map((c) => c.id));
  r = await req('GET', '/conversas?arquivadas=true', null, anunciante.token);
  ok('aparece no filtro de arquivadas', r.corpo.dados.some((c) => c.id === conversaId), r.corpo.dados.length);
  r = await req('GET', '/conversas', null, interessado.token);
  ok('arquivar é pessoal: o outro continua vendo', r.corpo.dados.some((c) => c.id === conversaId), r.corpo.dados.length);
  await req('DELETE', '/conversas/' + conversaId + '/arquivar', null, anunciante.token);

  r = await req('POST', '/conversas/' + conversaId + '/encerrar', { motivo: 'negócio fechado' }, anunciante.token);
  ok('encerra → 200', r.status === 200 && r.corpo.dados.status === 'encerrada', r.corpo);
  r = await req('POST', '/conversas/' + conversaId + '/mensagens', { conteudo: 'depois de encerrada' }, interessado.token);
  ok('conversa encerrada não recebe mensagem → 400', r.status === 400, r.corpo);

  socket.close();
  console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTodas as verificações passaram.');

  servidor.close();
  await tempoReal.encerrar().catch(() => null);
  await db.sequelize.close();
  await encerrarInfra();
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  servidor?.close();
  process.exit(1);
});
