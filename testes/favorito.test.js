'use strict';

/**
 * Favoritos, de ponta a ponta, contra a API e o banco de verdade.
 *
 *   node testes/favorito.test.js
 *
 * O que esta suíte precisa provar, além do caminho feliz:
 *   · favoritar é idempotente e NÃO infla `total_favoritos`;
 *   · ninguém lê a lista de outro (403);
 *   · anúncio removido some da lista;
 *   · a checagem "está favoritado?" resolve em lote, numa consulta.
 */

process.env.NODE_ENV = 'development';

const { RAIZ, montarApp, cliente, criarUsuario, criarAnuncio, ok } = require('./apoio.cenario');
const { limparLimites, encerrarInfra } = require('./apoio');
const db = require(RAIZ + '/src/models');
const { randomUUID } = require('crypto');

/* UUID de verdade: o validador exige v4, e '1111…' não passa dele — o teste
   ficaria provando a mensagem de validação em vez do 404 que interessa */
const INEXISTENTE = randomUUID();
const NAO_SALVO = randomUUID();

let server;

(async () => {
  await limparLimites();

  const app = montarApp('/api/v1/favoritos', require(RAIZ + '/src/features/favorito/favorito.routes'));
  server = app.listen(0);
  const req = cliente('http://127.0.0.1:' + server.address().port + '/api/v1/favoritos');

  const marca = Date.now();
  const dono = await criarUsuario(`fav-dono-${marca}`);
  const curioso = await criarUsuario(`fav-curioso-${marca}`);
  const anuncio = await criarAnuncio(dono.usuario, dono.perfil, `fav-${marca}`);
  const outro = await criarAnuncio(dono.usuario, dono.perfil, `fav2-${marca}`);

  console.log('\n— salvar —');
  let r = await req('POST', '/', { anuncioId: anuncio.id }, curioso.token);
  ok('favorita → 201', r.status === 201 && r.corpo?.dados?.criado === true, r.corpo);
  ok('devolve o card do anúncio', r.corpo?.dados?.anuncio?.titulo === anuncio.titulo, r.corpo?.dados);

  r = await req('POST', '/', { anuncioId: anuncio.id }, curioso.token);
  ok('favoritar de novo → 200 e criado=false (idempotente)', r.status === 200 && r.corpo?.dados?.criado === false, r.corpo);

  await req('POST', '/', { anuncioId: anuncio.id, anotacao: 'perguntar frete' }, curioso.token);

  const linhas = await db.Favorito.count({ where: { usuario_id: curioso.usuario.id, anuncio_id: anuncio.id } });
  ok('não duplicou a linha', linhas === 1, linhas);

  await anuncio.reload();
  ok('contador não inflou com o duplo clique', anuncio.total_favoritos === 1, anuncio.total_favoritos);

  const salvo = await db.Favorito.findOne({ where: { usuario_id: curioso.usuario.id, anuncio_id: anuncio.id } });
  ok('re-salvar atualiza a anotação', salvo.anotacao === 'perguntar frete', salvo.anotacao);

  r = await req('POST', '/', { anuncioId: INEXISTENTE }, curioso.token);
  ok('anúncio inexistente → 404', r.status === 404, r.corpo);
  r = await req('POST', '/', { anuncioId: 'nao-e-uuid' }, curioso.token);
  ok('id inválido → 422', r.status === 422, r.corpo);
  r = await req('POST', '/', { anuncioId: anuncio.id });
  ok('sem token → 401', r.status === 401, r.corpo);

  console.log('\n— listar —');
  await req('POST', '/', { anuncioId: outro.id }, curioso.token);
  r = await req('GET', '/', null, curioso.token);
  ok('lista os dois salvos', r.status === 200 && r.corpo.dados.length === 2, r.corpo?.meta);
  ok('paginação vem no meta', r.corpo?.meta?.total === 2 && r.corpo?.meta?.pagina === 1, r.corpo?.meta);
  ok('card traz preço e status', r.corpo.dados[0]?.anuncio?.precoCentavos === 250000 && r.corpo.dados[0]?.anuncio?.status === 'publicado', r.corpo.dados[0]);
  ok('não vaza contato do anunciante', !JSON.stringify(r.corpo).toLowerCase().includes('whatsapp'), r.corpo.dados[0]);

  r = await req('GET', '/', null, dono.token);
  ok('a lista de cada um é a sua', r.status === 200 && r.corpo.dados.length === 0, r.corpo);

  console.log('\n— lote (o ponto crítico de performance) —');
  const ids = [anuncio.id, outro.id, NAO_SALVO];
  r = await req('POST', '/marcados', { anuncioIds: ids }, curioso.token);
  ok('checagem em lote → mapa por id', r.status === 200 && r.corpo.dados[anuncio.id] === true && r.corpo.dados[outro.id] === true, r.corpo);
  ok('id não favoritado não aparece no mapa', r.corpo.dados[NAO_SALVO] === undefined, r.corpo);

  // uma consulta só, e não uma por item: conta o SQL emitido
  let consultas = 0;
  const anotarSql = (sql) => { if (/FROM "?favoritos"?/i.test(sql)) consultas += 1; };
  db.sequelize.options.logging = anotarSql;
  const consultaService = require(RAIZ + '/src/features/favorito/favorito.consulta.service');
  await consultaService.marcados({ usuarioId: curioso.usuario.id }, [anuncio.id, outro.id, ...Array.from({ length: 40 }, () => randomUUID())]);
  db.sequelize.options.logging = false;
  ok('42 ids resolvidos em UMA consulta (sem N+1)', consultas === 1, consultas);

  r = await req('POST', '/marcados', { anuncioIds: Array.from({ length: 200 }, () => anuncio.id) }, curioso.token);
  ok('lote acima do teto → 422', r.status === 422, r.corpo);

  console.log('\n— escopo: favorito é dado pessoal —');
  r = await req('GET', '/usuarios/' + curioso.usuario.id, null, dono.token);
  ok('ler favorito alheio → 403', r.status === 403, r.corpo);
  r = await req('GET', '/usuarios/' + curioso.usuario.id, null, curioso.token);
  ok('ler a própria lista pelo id → 200', r.status === 200, r.corpo);

  console.log('\n— contador do anúncio —');
  r = await req('GET', '/anuncios/' + anuncio.id + '/contador', null, dono.token);
  ok('o dono vê quantos salvaram', r.status === 200 && r.corpo.dados.total === 1, r.corpo);
  r = await req('GET', '/anuncios/' + anuncio.id + '/contador', null, curioso.token);
  ok('quem não é dono → 403', r.status === 403, r.corpo);

  console.log('\n— remover —');
  r = await req('DELETE', '/' + outro.id, null, curioso.token);
  ok('desfavorita → 204', r.status === 204, r.corpo);
  await outro.reload();
  ok('contador desce', outro.total_favoritos === 0, outro.total_favoritos);
  r = await req('DELETE', '/' + outro.id, null, curioso.token);
  ok('desfavoritar de novo → 204 (idempotente)', r.status === 204, r.corpo);
  await outro.reload();
  ok('contador não vai a negativo', outro.total_favoritos === 0, outro.total_favoritos);

  console.log('\n— anúncio removido some da lista —');
  await anuncio.destroy(); // soft delete: o model é paranoid
  r = await req('GET', '/', null, curioso.token);
  ok('anúncio removido não aparece nos favoritos', r.status === 200 && r.corpo.dados.length === 0, r.corpo.dados);
  const aindaSalvo = await db.Favorito.count({ where: { usuario_id: curioso.usuario.id, anuncio_id: anuncio.id } });
  ok('a linha continua no banco (a FK CASCADE cuida da exclusão definitiva)', aindaSalvo === 1, aindaSalvo);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
