'use strict';

/**
 * Mídia de ponta a ponta, contra a API, o storage e o banco de verdade.
 *
 * Não é unitário de propósito: o que interessa aqui é o que um cliente
 * multipart consegue fazer pela rede — que é a mesma superfície que um
 * atacante enxerga.
 *
 *   node testes/midia.test.js
 *
 * O módulo ainda não está montado em `src/routes/index.js` (arquivo do
 * orquestrador), então a suíte sobe um app próprio com a mesma pilha de
 * middlewares da aplicação. É o mesmo router que entrará em produção.
 */

process.env.NODE_ENV = 'development';

const RAIZ = require('path').resolve(__dirname, '..');
const fs = require('fs');
const path = require('path');
const express = require('express');
const sharp = require('sharp');

const { limparLimites, encerrarInfra } = require('./apoio');
const db = require(RAIZ + '/src/models');
const config = require(RAIZ + '/src/config');
const middlewares = require(RAIZ + '/src/middlewares');
const processamento = require(RAIZ + '/src/features/midia/midia.processamento.service');
const limpeza = require(RAIZ + '/src/features/midia/midia.limpeza.service');

let server;
let base;

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(middlewares.contexto);
app.use('/api/v1/auth', require(RAIZ + '/src/features/auth/auth.routes'));
app.use('/api/v1/midia', require(RAIZ + '/src/features/midia/midia.routes'));
app.use(middlewares.erro);

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

/** envio multipart de verdade — é o caminho que o front usa */
const enviar = async (arquivos, token, extras = {}) => {
  const form = new FormData();
  arquivos.forEach(({ nome, buffer, tipo, campo }) =>
    form.append(campo || 'arquivos', new Blob([buffer], { type: tipo }), nome)
  );
  Object.entries(extras).forEach(([chave, valor]) => form.append(chave, valor));

  const r = await fetch(base + '/api/v1/midia', {
    method: 'POST',
    headers: token ? { authorization: 'Bearer ' + token } : {},
    body: form,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

const ok = (nome, cond, extra) =>
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));

const imagem = (largura, altura, formato = 'jpeg') =>
  sharp({
    create: { width: largura, height: altura, channels: 3, background: { r: 120, g: 80, b: 40 } },
  })
    [formato]()
    .toBuffer();

async function contaNova(sufixo) {
  const email = `midia${sufixo}${Date.now()}@agropecas.dev`;
  const r = await req('POST', '/api/v1/auth/registrar', {
    nome: 'teste midia ' + sufixo,
    email,
    senha: 'SenhaForte123',
    tipoPerfil: 'produtor',
    aceiteTermos: true,
    aceitePrivacidade: true,
  });
  if (r.status !== 201) throw new Error('não criou conta de teste: ' + JSON.stringify(r.corpo));
  return { email, token: r.corpo.dados.tokens.acesso, usuarioId: r.corpo.dados.usuario.id };
}

const noDisco = (relativo) => fs.existsSync(path.join(path.resolve(config.storage.localPath), relativo));

(async () => {
  await limparLimites();
  server = app.listen(0);
  base = 'http://127.0.0.1:' + server.address().port;

  const dono = await contaNova('a');
  const terceiro = await contaNova('b');

  console.log('\n— upload válido —');
  const jpeg = await imagem(1200, 900, 'jpeg');
  const png = await imagem(400, 400, 'png');

  let r = await enviar(
    [
      { nome: 'trator-frente.jpg', buffer: jpeg, tipo: 'image/jpeg' },
      { nome: 'peca.png', buffer: png, tipo: 'image/png' },
    ],
    dono.token
  );
  ok('upload de duas imagens → 201', r.status === 201 && r.corpo.dados.length === 2, r.corpo);
  ok('responde sem processar (status processando)', r.corpo?.dados?.[0]?.status === 'processando', r.corpo?.dados?.[0]);
  ok('devolve URL utilizável do original', /^https?:\/\//.test(r.corpo?.dados?.[0]?.url || ''), r.corpo?.dados?.[0]?.url);
  ok('não vaza path nem hash do storage', !JSON.stringify(r.corpo).includes('hash_conteudo') && !JSON.stringify(r.corpo).includes('"path"'));

  const arquivoId = r.corpo.dados[0].id;
  const linha = await db.Arquivo.findByPk(arquivoId);
  ok('mime gravado é o REAL, não o do cabeçalho', linha.mime === 'image/jpeg', linha.mime);
  ok('nome do cliente não virou caminho no disco', !linha.path.includes('trator-frente'), linha.path);
  ok('caminho é UUID gerado pelo storage', /^midia\/originais\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/.test(linha.path), linha.path);
  ok('dono é o do token, não o corpo', String(linha.usuario_id) === String(dono.usuarioId));

  console.log('\n— segurança do conteúdo —');
  r = await enviar(
    [{ nome: 'foto.jpg', buffer: Buffer.from('%PDF-1.7\n%truque\n' + 'A'.repeat(2000)), tipo: 'image/jpeg' }],
    dono.token
  );
  ok('extensão .jpg com conteúdo de outro tipo → 422', r.status === 422, r.corpo);

  r = await enviar(
    [{ nome: 'logo.svg', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), tipo: 'image/svg+xml' }],
    dono.token
  );
  ok('SVG recusado (carrega script) → 422', r.status === 422, r.corpo);

  /* JPEG legítimo no cabeçalho e no nome, mas com corpo lixo: passa pela
     assinatura e tem de morrer na leitura de metadados */
  const falsoJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5000, 0x41)]);
  r = await enviar([{ nome: 'quebrada.jpg', buffer: falsoJpeg, tipo: 'image/jpeg' }], dono.token);
  ok('assinatura certa mas imagem corrompida → recusada', r.status === 400 || r.status === 422, r.corpo);

  console.log('\n— limites —');
  const acimaDoLimite = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(config.midia.maxBytesPorArquivo + 1024, 0x42),
  ]);
  r = await enviar([{ nome: 'gigante.jpg', buffer: acimaDoLimite, tipo: 'image/jpeg' }], dono.token);
  ok('arquivo acima do limite de tamanho → 422', r.status === 422, r.corpo);

  const muitos = Array.from({ length: config.midia.maxArquivosPorRequisicao + 3 }, (_, i) => ({
    nome: `f${i}.png`,
    buffer: png,
    tipo: 'image/png',
  }));
  r = await enviar(muitos, dono.token);
  ok('quantidade acima do limite → 422', r.status === 422, r.corpo);

  const larga = await imagem(config.midia.maxDimensao + 200, 8, 'png');
  r = await enviar([{ nome: 'faixa.png', buffer: larga, tipo: 'image/png' }], dono.token);
  ok('dimensão acima do teto (bomba) → 422', r.status === 422, r.corpo);

  r = await enviar([{ nome: 'x.png', buffer: png, tipo: 'image/png' }], null);
  ok('upload sem token → 401', r.status === 401, r.corpo);

  console.log('\n— processamento na fila —');
  const primeira = await processamento.gerarVariantes(arquivoId);
  ok('job gera as três variantes', primeira.geradas.length === 3, primeira);

  const variantes = await db.Arquivo.findAll({ where: { referencia_id: arquivoId, referencia_tipo: 'midia_variante' } });
  ok('todas em WebP', variantes.length === 3 && variantes.every((v) => v.mime === 'image/webp'), variantes.map((v) => v.mime));
  ok('variante está no disco', variantes.every((v) => noDisco(v.path)), variantes.map((v) => v.path));

  const meta = await sharp(fs.readFileSync(path.join(path.resolve(config.storage.localPath), variantes.find((v) => v.path.includes('/thumb/')).path))).metadata();
  ok('thumb redimensionada para 320px', meta.width === 320 && meta.format === 'webp', meta);

  const segunda = await processamento.gerarVariantes(arquivoId);
  ok('job é idempotente (rodar de novo não duplica)', segunda.geradas.length === 0 && segunda.reaproveitadas.length === 3, segunda);
  const depois = await db.Arquivo.count({ where: { referencia_id: arquivoId, referencia_tipo: 'midia_variante' } });
  ok('continuam três variantes após reexecução', depois === 3, depois);

  console.log('\n— consulta —');
  r = await req('GET', '/api/v1/midia?porPagina=50', null, dono.token);
  ok('lista paginada do próprio usuário → 200', r.status === 200 && r.corpo.dados.length >= 2, r.corpo?.meta);
  ok('listagem não mostra as variantes como itens', !r.corpo.dados.some((item) => item.referencia?.tipo === 'midia_variante'));
  ok('só devolve arquivo do próprio usuário', r.corpo.dados.length === (await db.Arquivo.count({ where: { usuario_id: dono.usuarioId, referencia_tipo: null } })), r.corpo.meta);

  r = await req('GET', '/api/v1/midia/' + arquivoId, null, dono.token);
  ok('detalhe traz status pronto e as três URLs', r.status === 200 && r.corpo.dados.status === 'pronto' && Object.values(r.corpo.dados.variantes).every(Boolean), r.corpo?.dados);

  r = await req('GET', '/api/v1/midia/' + arquivoId, null, terceiro.token);
  ok('detalhe de arquivo alheio → 403', r.status === 403, r.corpo);

  console.log('\n— remoção e escopo —');
  r = await req('DELETE', '/api/v1/midia/' + arquivoId, null, terceiro.token);
  ok('remover arquivo alheio → 403', r.status === 403, r.corpo);
  ok('arquivo alheio continua no banco', !!(await db.Arquivo.findByPk(arquivoId)));

  const caminhos = [linha.path, ...variantes.map((v) => v.path)];
  r = await req('DELETE', '/api/v1/midia/' + arquivoId, null, dono.token);
  ok('dono remove o próprio → 204', r.status === 204, r.corpo);
  ok('sumiu do disco (original e variantes)', caminhos.every((c) => !noDisco(c)), caminhos.filter(noDisco));
  ok('linha some da API mas fica como rastro (paranoid)', !(await db.Arquivo.findByPk(arquivoId)) && !!(await db.Arquivo.findByPk(arquivoId, { paranoid: false })));

  r = await req('DELETE', '/api/v1/midia/' + arquivoId, null, dono.token);
  ok('remover duas vezes → 404', r.status === 404, r.corpo);

  console.log('\n— faxina de órfãos —');
  const upload = await enviar([{ nome: 'orfa.png', buffer: png, tipo: 'image/png' }], dono.token);
  const orfaId = upload.corpo.dados[0].id;
  const orfa = await db.Arquivo.findByPk(orfaId);

  /* envelhece o registro para a janela do job sem esperar 24h de relógio */
  await db.Arquivo.update(
    { criado_em: new Date(Date.now() - (config.midia.orfaoHoras + 1) * 3600 * 1000) },
    { where: { id: orfaId }, silent: true }
  );
  const marcados = await limpeza.marcarOrfaos();
  ok('marca upload sem vínculo para descarte', marcados >= 1 && !!(await db.Arquivo.findByPk(orfaId)).descartar_em, marcados);

  await db.Arquivo.update({ descartar_em: new Date(Date.now() - 1000) }, { where: { id: orfaId }, silent: true });
  const faxina = await limpeza.descartarMarcados();
  ok('descarta o que passou da carência', faxina.originais >= 1 && !noDisco(orfa.path), faxina);
  ok('órfã sumiu da listagem', !(await db.Arquivo.findByPk(orfaId)));

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
