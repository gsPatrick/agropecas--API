'use strict';

/**
 * Comunidade do painel (denúncias, conversas, comunicados) de ponta a ponta,
 * contra a API e o banco de verdade.
 *
 *   node testes/admin.comunidade.test.js
 *
 * O que esta suíte guarda não é a "funcionalidade" — é o PREÇO do poder. A
 * cliente pediu que o Admin pudesse ler conversa privada e falar com a base
 * inteira; as travas que tornam isso aceitável (motivo obrigatório, registro em
 * `logs_acesso_dado`, conferência de público, soft delete) só valem se
 * quebrarem o teste quando alguém as remover. É esse o alvo aqui.
 *
 * O router do admin ainda não está montado em `src/routes/index.js` (linha
 * comentada, arquivo que este módulo não pode editar), então a suíte monta um
 * app próprio com os MESMOS middlewares globais do `app.js`.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');

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

/* documento é único no banco: valor fixo faria a suíte passar só na primeira vez */
function cnpjValido() {
  const inicio = Array.from({ length: 12 }, (_, i) =>
    i < 8 ? Math.floor(Math.random() * 10) : [0, 0, 0, 1][i - 8]
  );
  const dv = (nums) => {
    let peso = nums.length - 7;
    let soma = 0;
    for (let i = 0; i < nums.length; i += 1) {
      soma += nums[i] * peso;
      peso -= 1;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(inicio);
  const d2 = dv([...inicio, d1]);
  return [...inicio, d1, d2].join('');
}

/** conta real pela API de auth: token forjado não exercitaria o RBAC */
async function criarUsuario(rotulo) {
  const email = `adm-com-${rotulo}-${marca}@agropecas.dev`;
  const r = await req('POST', '/auth/registrar', {
    nome: `Admin Com ${rotulo} ${marca}`,
    email,
    senha: 'SenhaForte123',
    tipoPerfil: 'loja',
    nomeExibicao: `Com ${rotulo} ${marca}`,
    documento: cnpjValido(),
    razaoSocial: `Com ${rotulo} LTDA`,
    aceiteTermos: true,
    aceitePrivacidade: true,
  });

  if (r.status !== 201) throw new Error('falha ao criar usuário: ' + JSON.stringify(r.corpo));
  return { email, senha: 'SenhaForte123', token: r.corpo.dados.tokens.acesso, id: r.corpo.dados.usuario.id };
}

/**
 * Promove a admin e refaz o login.
 *
 * O login precisa ser refeito porque as permissões entram no token: reaproveitar
 * o token anterior testaria um Admin sem poder nenhum e todo 403 viraria falso
 * positivo.
 */
async function promoverAAdmin(usuario) {
  const papel = await db.Papel.findOne({ where: { chave: 'admin' } });
  if (!papel) throw new Error('papel admin não existe — rode `npm run rbac:sync`');

  await db.UsuarioPapel.findOrCreate({
    where: { usuario_id: usuario.id, papel_id: papel.id },
    defaults: { usuario_id: usuario.id, papel_id: papel.id },
  });

  const r = await req('POST', '/auth/entrar', { email: usuario.email, senha: usuario.senha });
  if (r.status !== 200) throw new Error('falha ao relogar admin: ' + JSON.stringify(r.corpo));
  return { ...usuario, token: r.corpo.dados.tokens.acesso };
}

async function criarAnuncio(usuarioId, sufixo) {
  const perfil = await db.Perfil.findOne({ where: { usuario_id: usuarioId } });
  return db.Anuncio.create({
    codigo: `AC${String(marca).slice(-6)}${sufixo}`,
    usuario_id: usuarioId,
    perfil_id: perfil.id,
    tipo: 'peca',
    titulo: `Bomba injetora painel ${marca}${sufixo}`,
    titulo_normalizado: `bomba injetora painel ${marca}${sufixo}`,
    slug: `bomba-injetora-painel-${marca}${sufixo}`,
    descricao: 'Peça de teste automatizado do painel.',
    preco_centavos: 150000,
    status: 'publicado',
    publicado_em: new Date(),
  });
}

(async () => {
  await limparLimites();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(middlewares.contexto);
  app.use('/api/v1/auth', require(RAIZ + '/src/features/auth/auth.routes'));
  app.use('/api/v1/conversas', require(RAIZ + '/src/features/conversa/conversa.routes'));
  app.use('/api/v1/admin', require(RAIZ + '/src/features/admin/admin.routes'));
  app.use(middlewares.erro);

  servidor = app.listen(0);
  base = 'http://127.0.0.1:' + servidor.address().port + '/api/v1';

  console.log('\n— preparação —');
  const anunciante = await criarUsuario('anunciante');
  const interessado = await criarUsuario('interessado');
  let admin = await criarUsuario('admin');
  admin = await promoverAAdmin(admin);
  ok('três contas criadas e uma promovida a admin', Boolean(admin.token));

  const anuncio = await criarAnuncio(anunciante.id, 'A');

  let r = await req('POST', '/conversas', { anuncioId: anuncio.id }, interessado.token);
  const conversaId = r.corpo?.dados?.id;
  ok('conversa criada entre as duas partes', r.status === 201 && Boolean(conversaId), r.corpo);

  r = await req(
    'POST',
    '/conversas/' + conversaId + '/mensagens',
    { conteudo: 'tem essa peça em estoque para entrega em Sorriso?' },
    interessado.token
  );
  const mensagemId = r.corpo?.dados?.id;
  ok('mensagem enviada na conversa', Boolean(mensagemId), r.corpo);

  /* denúncia sobre a conversa: é ela que dá o vínculo da leitura do §4 */
  const denuncia = await db.Denuncia.create({
    denunciante_id: interessado.id,
    denunciado_id: anunciante.id,
    alvo_tipo: 'conversa',
    alvo_id: conversaId,
    motivo: 'golpe',
    descricao: 'pediu pagamento antecipado por fora da plataforma',
    status: 'aberta',
  });

  // ─────────────────────────────────────────────────────────────
  console.log('\n— a porta do painel —');

  r = await req('GET', '/admin/denuncias', null, interessado.token);
  ok('usuário comum não entra na fila de denúncias → 403', r.status === 403, r.corpo);

  r = await req('GET', '/admin/conversas', null, interessado.token);
  ok('usuário comum não lista conversas do painel → 403', r.status === 403, r.corpo);

  r = await req('GET', '/admin/denuncias', null, null);
  ok('sem token → 401', r.status === 401, r.corpo);

  r = await req('GET', '/admin/denuncias', null, admin.token);
  ok('admin lista a fila → 200', r.status === 200, r.corpo);
  const naFila = (r.corpo?.dados || []).find((linha) => linha.id === denuncia.id);
  ok('a denúncia criada aparece na fila', Boolean(naFila), r.corpo?.dados?.length);
  ok('a fila NÃO expõe o denunciante', !JSON.stringify(r.corpo).includes(interessado.id), {
    denunciante: interessado.id,
  });
  ok('a linha traz o alvo resolvido (sem N+1 por linha)', Boolean(naFila?.alvo?.id), naFila?.alvo);

  r = await req('GET', '/admin/denuncias/agrupadas', null, admin.token);
  ok('agrupamento por alvo → 200', r.status === 200, r.corpo);

  // ─────────────────────────────────────────────────────────────
  console.log('\n— §4: ler conversa privada —');

  r = await req('GET', '/admin/conversas/' + conversaId, null, admin.token);
  ok('sem motivo, sem leitura → 422', r.status === 422, r.corpo);
  ok('o 422 aponta o campo motivo', Boolean(r.corpo?.erro?.detalhe?.campos?.motivo), r.corpo?.erro);

  r = await req('GET', '/admin/conversas/' + conversaId + '?motivo=abuso', null, admin.token);
  ok('motivo curto demais também é recusado → 422', r.status === 422, r.corpo);

  const motivo = `apuracao da denuncia ${String(denuncia.id).slice(0, 8)}`;
  const antes = await db.LogAcessoDado.count({ where: { ator_id: admin.id, recurso: 'conversa' } });

  r = await req(
    'GET',
    '/admin/conversas/' + conversaId + '?motivo=' + encodeURIComponent(motivo),
    null,
    admin.token
  );
  ok('com motivo, o admin lê a conversa → 200', r.status === 200, r.corpo);
  ok('as mensagens vêm no corpo', (r.corpo?.dados?.mensagens || []).length >= 1, r.corpo?.dados);
  ok('a resposta ecoa o motivo registrado', r.corpo?.dados?.acesso?.motivo === motivo, r.corpo?.dados?.acesso);
  ok(
    'a denúncia da conversa é vinculada sozinha',
    r.corpo?.dados?.acesso?.denunciaId === denuncia.id,
    r.corpo?.dados?.acesso
  );

  const registros = await db.LogAcessoDado.findAll({
    where: { ator_id: admin.id, recurso: 'conversa', recurso_id: conversaId, motivo },
    order: [['criado_em', 'ASC']],
  });
  ok('a leitura gravou logs_acesso_dado COM o motivo', registros.length >= 1, registros.length);
  ok(
    'gravou uma linha por titular da conversa',
    new Set(registros.map((linha) => String(linha.titular_id))).size === 2,
    registros.map((linha) => linha.titular_id)
  );
  ok(
    'o registro carrega o vínculo com a denúncia',
    registros.every((linha) => String(linha.denuncia_id) === String(denuncia.id)),
    registros.map((linha) => linha.denuncia_id)
  );
  const depois = await db.LogAcessoDado.count({ where: { ator_id: admin.id, recurso: 'conversa' } });
  ok('nenhuma leitura passou sem registro', depois > antes, { antes, depois });

  const auditadas = await db.LogAuditoria.count({
    where: { ator_id: admin.id, entidade: 'conversas', entidade_id: conversaId },
  });
  ok('a leitura também entrou na trilha de auditoria', auditadas >= 1, auditadas);

  r = await req(
    'GET',
    '/admin/conversas/' + crypto.randomUUID() + '?motivo=' + encodeURIComponent(motivo),
    null,
    admin.token
  );
  ok('conversa inexistente → 404 mesmo com motivo', r.status === 404, r.corpo);

  // ─────────────────────────────────────────────────────────────
  console.log('\n— resolver denúncia —');

  r = await req('POST', '/admin/denuncias/' + denuncia.id + '/resolver', {}, admin.token);
  ok('resolver sem veredito → 422', r.status === 422, r.corpo);

  r = await req(
    'POST',
    '/admin/denuncias/' + denuncia.id + '/resolver',
    { status: 'procedente', acaoTomada: 'mensagem_removida' },
    admin.token
  );
  ok('veredito sem a decisão escrita → 422', r.status === 422, r.corpo);

  r = await req(
    'POST',
    '/admin/denuncias/' + denuncia.id + '/resolver',
    { status: 'improcedente', acaoTomada: 'nenhuma', resolucao: 'nao ha violacao das regras' },
    admin.token
  );
  ok('veredito completo → 200', r.status === 200, r.corpo);

  await denuncia.reload();
  ok('o desfecho foi persistido', denuncia.status === 'improcedente', denuncia.status);
  ok('a decisão ficou gravada', Boolean(denuncia.resolucao), denuncia.resolucao);

  // ─────────────────────────────────────────────────────────────
  console.log('\n— remoção de mensagem: soft delete —');

  r = await req('DELETE', '/admin/mensagens/' + mensagemId, {}, admin.token);
  ok('remover sem motivo → 422', r.status === 422, r.corpo);

  r = await req(
    'DELETE',
    '/admin/mensagens/' + mensagemId,
    { motivo: 'conteudo que combina pagamento fora da plataforma' },
    admin.token
  );
  ok('remoção com motivo → 200', r.status === 200, r.corpo);

  const mensagem = await db.Mensagem.findByPk(mensagemId);
  ok('a linha CONTINUA no banco (soft delete)', Boolean(mensagem), mensagemId);
  ok('marcada como removida', Boolean(mensagem?.removida_em), mensagem?.removida_em);
  ok('o motivo ficou gravado na própria mensagem', Boolean(mensagem?.removida_motivo), mensagem?.removida_motivo);
  ok('o conteúdo original foi preservado para apuração', Boolean(mensagem?.conteudo), null);

  // ─────────────────────────────────────────────────────────────
  console.log('\n— comunicado: a trava de público —');

  const segmento = { usuarioIds: [interessado.id, anunciante.id] };

  r = await req(
    'POST',
    '/admin/comunicados',
    {
      titulo: 'Manutenção no domingo',
      mensagem: 'A plataforma ficará indisponível das 2h às 4h.',
      segmento,
      publicoEsperado: 5000,
    },
    admin.token
  );
  ok('público informado divergente do real → recusado', r.status === 409, r.corpo);
  ok('o erro diz qual é o público real', r.corpo?.erro?.detalhe?.publicoReal === 2, r.corpo?.erro);
  ok('e identifica o motivo da recusa', r.corpo?.erro?.detalhe?.code === 'PUBLICO_DIVERGENTE', r.corpo?.erro);

  r = await req(
    'POST',
    '/admin/comunicados',
    {
      titulo: 'Manutenção no domingo',
      mensagem: 'A plataforma ficará indisponível das 2h às 4h.',
      segmento,
      publicoEsperado: 2,
      motivo: 'aviso de janela de manutencao',
    },
    admin.token
  );
  ok('público conferido → 202 (aceito, não entregue)', r.status === 202, r.corpo);
  ok('devolve o lote e os dois números', Boolean(r.corpo?.dados?.loteId) && r.corpo?.dados?.publicoReal === 2, r.corpo?.dados);

  const trilhaComunicado = await db.LogAuditoria.findOne({
    where: { ator_id: admin.id, acao: 'enviar_comunicado' },
    order: [['criado_em', 'DESC']],
  });
  ok('a conferência de público entrou na auditoria', Boolean(trilhaComunicado), null);
  ok(
    'com o esperado e o real lado a lado',
    trilhaComunicado?.depois?.publicoEsperado === 2 && trilhaComunicado?.depois?.publicoReal === 2,
    trilhaComunicado?.depois
  );

  r = await req('GET', '/admin/comunicados', null, admin.token);
  ok('listagem de comunicados → 200', r.status === 200, r.corpo);

  r = await req('GET', '/admin/notificacoes/templates', null, admin.token);
  ok('listagem de templates → 200', r.status === 200, r.corpo);

  console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTudo certo.\n');
  servidor.close();
  await encerrarInfra();
  process.exit(falhas ? 1 : 0);
})().catch(async (erro) => {
  console.error('\nERRO NA SUÍTE:', erro);
  if (servidor) servidor.close();
  await encerrarInfra().catch(() => null);
  process.exit(1);
});
