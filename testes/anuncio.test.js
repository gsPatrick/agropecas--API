'use strict';

/**
 * Fluxo do módulo de anúncios de ponta a ponta, contra a API e o banco de
 * verdade. Não é unitário de propósito: o que interessa é o comportamento
 * observável pela rede — o que o front vê e o que um curioso consegue.
 *
 *   node testes/anuncio.test.js
 *
 * O router é montado num app próprio porque `src/routes/index.js` ainda não
 * registra a feature (o arquivo é do orquestrador; ver o relatório). A pilha
 * montada aqui é idêntica à do `app.js`: contexto → rotas → handler de erro.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const { limparLimites, encerrarInfra } = require('./apoio');
const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');
const metricaService = require(RAIZ + '/src/features/anuncio/anuncio.metrica.service');

const app = express();
app.use(express.json());
app.use(middlewares.contexto);
app.use('/api/v1/auth', require(RAIZ + '/src/features/auth/auth.routes'));
app.use('/api/v1/anuncios', require(RAIZ + '/src/features/anuncio/anuncio.routes'));
app.use(middlewares.erro);

let server, base;
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

const marca = Date.now();

async function conta(sufixo, extras = {}) {
  const email = `anuncio${marca}${sufixo}@agropecas.dev`;
  const r = await req('POST', '/api/v1/auth/registrar', {
    nome: 'Teste Anuncio ' + sufixo,
    email,
    senha: 'SenhaForte123',
    whatsapp: '65999990000',
    tipoPerfil: 'loja',
    nomeExibicao: 'Loja Teste ' + marca + sufixo,
    aceiteTermos: true,
    aceitePrivacidade: true,
    ...extras,
  });
  return {
    email,
    token: r.corpo?.dados?.tokens?.acesso,
    usuarioId: r.corpo?.dados?.usuario?.id,
    perfilId: r.corpo?.dados?.perfil?.id,
  };
}

/** o upload é do módulo `midia`; aqui o `Arquivo` é semeado direto */
const arquivo = (usuarioId, n) =>
  db.Arquivo.create({
    usuario_id: usuarioId,
    driver: 'local',
    path: `testes/${marca}-${n}.jpg`,
    url: `http://local/uploads/${marca}-${n}.jpg`,
    nome_original: 'peca.jpg',
    mime: 'image/jpeg',
    tamanho_bytes: 1024,
  });

(async () => {
  await limparLimites();
  server = app.listen(0);
  base = 'http://127.0.0.1:' + server.address().port;

  const A = await conta('a');
  const B = await conta('b', { exibirWhatsapp: false });

  /* catálogo e municípios vêm do seed, mas outro módulo pode estar mexendo
     neles em paralelo: a suíte cria o que faltar em vez de depender do estado */
  const categoria =
    (await db.Categoria.findOne({ where: { ativo: true } })) ||
    (await db.Categoria.create({
      nome: 'Teste ' + marca,
      nome_normalizado: 'teste ' + marca,
      slug: 'teste-' + marca,
      tipo: 'peca',
    }));
  const municipio = await db.Municipio.findOne();
  const fotoA = await arquivo(A.usuarioId, 'a');
  const fotoA2 = await arquivo(A.usuarioId, 'a2');
  const fotoB = await arquivo(B.usuarioId, 'b');

  const corpoBase = {
    titulo: 'Bomba hidráulica para trator ' + marca,
    descricao: 'Peça revisada, funcionando.',
    categoriaId: categoria.id,
    municipioId: municipio.id,
    uf: municipio.uf,
    precoCentavos: 150000,
    condicao: 'usada',
  };

  console.log('\n— criação —');
  let r = await req('POST', '/api/v1/anuncios', corpoBase, A.token);
  ok('cria rascunho → 201', r.status === 201, r.corpo);
  ok('nasce como rascunho', r.corpo?.dados?.status === 'rascunho', r.corpo?.dados?.status);
  ok('gera código público AGP-', /^AGP-[A-Z0-9]{4}$/.test(r.corpo?.dados?.codigo || ''), r.corpo?.dados?.codigo);
  const anuncioA = r.corpo.dados.id;

  r = await req('POST', '/api/v1/anuncios', { ...corpoBase, precoCentavos: undefined }, A.token);
  ok('sem preço e sem "a combinar" → 422 no campo', r.status === 422 && !!r.corpo?.erro?.detalhe?.campos?.precoCentavos, r.corpo);

  r = await req('POST', '/api/v1/anuncios', { ...corpoBase, usuarioId: B.usuarioId }, A.token);
  const dono = await db.Anuncio.findByPk(r.corpo?.dados?.id, { attributes: ['usuario_id'] });
  ok('usuario_id do corpo é ignorado (vem do contexto)', String(dono?.usuario_id) === String(A.usuarioId), dono?.usuario_id);
  const anuncioLixo = r.corpo?.dados?.id;

  r = await req('POST', '/api/v1/anuncios', corpoBase, null);
  ok('criar sem token → 401', r.status === 401, r.corpo);

  console.log('\n— fotos —');
  r = await req('POST', `/api/v1/anuncios/${anuncioA}/fotos`, { arquivos: [fotoB.id] }, A.token);
  ok('vincular foto ALHEIA → recusado (422)', r.status === 422, r.corpo);

  r = await req('POST', `/api/v1/anuncios/${anuncioA}/fotos`, { arquivos: [fotoA.id, fotoA2.id] }, A.token);
  ok('vincular foto própria → 201', r.status === 201, r.corpo);
  ok('primeira foto vira capa', r.corpo?.dados?.[0]?.principal === true, r.corpo?.dados);
  const fotos = r.corpo.dados;

  r = await req('PATCH', `/api/v1/anuncios/${anuncioA}/fotos/${fotos[1].id}/capa`, null, A.token);
  ok('definir capa move a marca', r.corpo?.dados?.find((f) => f.id === fotos[1].id)?.principal === true, r.corpo?.dados);

  r = await req('PATCH', `/api/v1/anuncios/${anuncioA}/fotos/ordem`, { ordem: [fotos[1].id, fotos[0].id] }, A.token);
  ok('reordenar → 200', r.status === 200 && r.corpo.dados[0].id === fotos[1].id, r.corpo);

  console.log('\n— publicação —');
  r = await req('POST', `/api/v1/anuncios/${anuncioLixo}/publicar`, {}, A.token);
  ok('publicar sem foto → 422 listando pendências', r.status === 422 && !!r.corpo?.erro?.detalhe?.campos?.fotos, r.corpo);

  r = await req('POST', `/api/v1/anuncios/${anuncioA}/publicar`, {}, A.token);
  ok('publicar → 200', r.status === 200, r.corpo);
  ok('status vira publicado', r.corpo?.dados?.status === 'publicado', r.corpo?.dados?.status);
  ok('ganha prazo de expiração da configuração', !!r.corpo?.dados?.expiraEm, r.corpo?.dados);

  const hist = await db.AnuncioHistorico.findAll({ where: { anuncio_id: anuncioA } });
  ok('histórico registra a mudança de status', hist.some((h) => h.status_novo === 'publicado'), hist.map((h) => h.status_novo));

  const audit = await db.LogAuditoria.findOne({ where: { entidade: 'anuncios', entidade_id: anuncioA, acao: 'publicar' } });
  ok('publicar grava auditoria', !!audit, audit);

  console.log('\n— vitrine pública —');
  r = await req('GET', '/api/v1/anuncios?porPagina=100', null, null);
  ok('vitrine responde sem login → 200', r.status === 200, r.corpo);
  const idsVitrine = (r.corpo?.dados || []).map((a) => a.id);
  ok('vitrine mostra o publicado', idsVitrine.includes(anuncioA));
  ok('vitrine NÃO mostra rascunho', !idsVitrine.includes(anuncioLixo));
  ok('cartão não traz descrição (TEXT fora da listagem)', r.corpo.dados.every((a) => a.descricao === undefined));
  ok('cartão traz capa e categoria numa consulta só', r.corpo.dados.find((a) => a.id === anuncioA)?.capa !== null);
  const gigante = await req('GET', '/api/v1/anuncios?porPagina=99999');
  ok(
    'paginação tem teto (recusa ou limita a 100)',
    gigante.status === 422 || gigante.corpo?.meta?.porPagina <= 100,
    gigante.corpo?.meta
  );

  console.log('\n— detalhe e contato —');
  r = await req('GET', `/api/v1/anuncios/${anuncioA}`, null, null);
  ok('detalhe público → 200', r.status === 200, r.corpo);
  ok('exibe whatsapp de quem consentiu', !!r.corpo?.dados?.anunciante?.whatsapp, r.corpo?.dados?.anunciante);
  ok('não expõe observações internas nem moderação', r.corpo.dados.moderacaoMotivo === undefined && !JSON.stringify(r.corpo).includes('observacoes_internas'));

  const publicadoB = await (async () => {
    const criado = await req('POST', '/api/v1/anuncios', corpoBase, B.token);
    await db.AnuncioFoto.create({ anuncio_id: criado.corpo.dados.id, path: fotoB.path, url: fotoB.url, ordem: 0, principal: true });
    await req('POST', `/api/v1/anuncios/${criado.corpo.dados.id}/publicar`, {}, B.token);
    return criado.corpo.dados.id;
  })();

  r = await req('GET', `/api/v1/anuncios/${publicadoB}`, null, null);
  ok('whatsapp OCULTO quando exibir_whatsapp = false', r.corpo?.dados?.anunciante?.whatsapp === null, r.corpo?.dados?.anunciante);
  ok('mas o perfil segue contactável pelo chat', r.corpo?.dados?.anunciante?.aceitaChat === true);
  ok('sem endereço exato, não sai coordenada', r.corpo?.dados?.localizacao?.latitude === null, r.corpo?.dados?.localizacao);

  r = await req('POST', `/api/v1/anuncios/${anuncioA}/contato`, { canal: 'whatsapp' }, null);
  ok('contato pelo WhatsApp funciona sem login', r.status === 200, r.corpo);
  const contato = await db.AnuncioContato.findOne({ where: { anuncio_id: anuncioA } });
  ok('contato fica registrado com hash de IP, não IP', !!contato && contato.ip_hash?.length === 64, contato?.canal);

  console.log('\n— visualização não inflável —');
  const ctx = { ipHash: 'hash-teste-' + marca };
  const v1 = await metricaService.registrarVisualizacao(ctx, anuncioA);
  const v2 = await metricaService.registrarVisualizacao(ctx, anuncioA);
  ok('primeira visita conta', v1.contabilizada === true, v1);
  ok('refresh do mesmo IP não conta', v2.contabilizada === false, v2);

  console.log('\n— escopo RBAC —');
  r = await req('PATCH', `/api/v1/anuncios/${anuncioA}`, { titulo: 'Invadido pelo B ' + marca }, B.token);
  ok('editar anúncio alheio publicado → 403', r.status === 403, r.corpo);

  r = await req('DELETE', `/api/v1/anuncios/${anuncioA}`, {}, B.token);
  ok('remover anúncio alheio → 403', r.status === 403, r.corpo);

  r = await req('GET', `/api/v1/anuncios/${anuncioLixo}`, null, B.token);
  ok('rascunho alheio → 404 (indistinguível de inexistente)', r.status === 404, r.corpo);

  r = await req('GET', `/api/v1/anuncios/${anuncioA}/metricas`, null, B.token);
  ok('métricas de anúncio alheio → 403', r.status === 403, r.corpo);

  r = await req('POST', `/api/v1/anuncios/${anuncioA}/ocultar`, { motivo: 'teste' }, A.token);
  ok('ocultar exige escopo de moderação → 403', r.status === 403, r.corpo);

  r = await req('POST', '/api/v1/anuncios', { ...corpoBase, emNomeDeUsuarioId: B.usuarioId }, A.token);
  ok('criar em nome de terceiro sem permissão → 403', r.status === 403, r.corpo);

  console.log('\n— métricas do dono —');
  r = await req('GET', `/api/v1/anuncios/${anuncioA}/metricas`, null, A.token);
  ok('dono vê as próprias métricas → 200', r.status === 200 && !!r.corpo?.dados?.totais, r.corpo);
  r = await req('GET', `/api/v1/anuncios/${anuncioA}/contatos`, null, A.token);
  ok('dono vê quem o procurou → 200', r.status === 200 && r.corpo.dados.length >= 1, r.corpo);

  console.log('\n— meus anúncios —');
  r = await req('GET', '/api/v1/anuncios/meus?porPagina=100', null, A.token);
  const meus = (r.corpo?.dados || []).map((a) => a.id);
  ok('lista os próprios, com rascunho', meus.includes(anuncioA) && meus.includes(anuncioLixo), meus.length);
  ok('não lista anúncio de terceiro', !meus.includes(publicadoB));

  console.log('\n— ciclo de vida —');
  r = await req('POST', `/api/v1/anuncios/${anuncioA}/pausar`, {}, A.token);
  ok('pausar → 200', r.status === 200 && r.corpo.dados.status === 'pausado', r.corpo);
  r = await req('GET', '/api/v1/anuncios?porPagina=100');
  ok('pausado sai da vitrine', !(r.corpo?.dados || []).map((a) => a.id).includes(anuncioA));
  r = await req('POST', `/api/v1/anuncios/${anuncioA}/pausar`, {}, A.token);
  ok('pausar o que já está pausado → 409', r.status === 409, r.corpo);
  r = await req('POST', `/api/v1/anuncios/${anuncioA}/renovar`, {}, A.token);
  ok('renovar devolve à vitrine', r.status === 200 && r.corpo.dados.status === 'publicado', r.corpo);

  console.log('\n— limite do plano —');
  const plano = await db.Plano.create({ chave: `teste_${marca}`, nome: 'Plano de teste', padrao: false, publico: false });
  await db.PlanoLimite.create({ plano_id: plano.id, chave: 'anuncios.ativos', valor: 1, periodo: 'total' });
  /* pelo service, não pelo model: a quota do anúncio hoje delega ao módulo
     `plano`, que mantém cache do plano efetivo. Escrever a assinatura direto no
     banco deixava o cache antigo valendo e o teto nunca chegava — exercitar o
     caminho real é o que dá valor ao teste */
  const assinaturaService = require(RAIZ + '/src/features/plano/plano.assinatura.service');
  await assinaturaService.atribuir(
    { usuarioId: B.usuarioId, planoId: plano.id },
    { usuarioId: B.usuarioId, admin: true, permissoes: new Set(['*']), papeis: ['admin'] }
  );

  const extra = await req('POST', '/api/v1/anuncios', corpoBase, B.token);
  await db.AnuncioFoto.create({ anuncio_id: extra.corpo.dados.id, path: fotoB.path, url: fotoB.url, ordem: 0, principal: true });
  r = await req('POST', `/api/v1/anuncios/${extra.corpo.dados.id}/publicar`, {}, B.token);
  ok('limite do plano barra a publicação → 409', r.status === 409 && r.corpo?.erro?.detalhe?.code === 'LIMITE_DO_PLANO', r.corpo);

  await db.Assinatura.destroy({ where: { plano_id: plano.id } });
  await require(RAIZ + '/src/features/plano/plano.cache').invalidarUsuario(B.usuarioId);
  r = await req('POST', `/api/v1/anuncios/${extra.corpo.dados.id}/publicar`, {}, B.token);
  ok('sem limite no plano (MVP gratuito) publica normalmente', r.status === 200, r.corpo);

  await db.PlanoLimite.destroy({ where: { plano_id: plano.id } });
  await db.Plano.destroy({ where: { id: plano.id }, force: true });

  console.log('\n— remoção —');
  r = await req('DELETE', `/api/v1/anuncios/${anuncioA}`, { motivo: 'vendido' }, A.token);
  ok('dono remove o próprio → 200', r.status === 200, r.corpo);
  const removido = await db.Anuncio.findByPk(anuncioA, { paranoid: false });
  ok('soft delete: linha continua para auditoria', !!removido && !!removido.removido_em && removido.status === 'removido');
  r = await req('GET', `/api/v1/anuncios/${anuncioA}`);
  ok('removido some da rota pública', r.status === 404, r.corpo);

  console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTodas as verificações passaram.');

  server.close();
  await encerrarInfra();
  await db.sequelize.close();
  process.exit(falhas ? 1 : 0);
})().catch(async (erro) => {
  console.error('erro na suíte:', erro);
  process.exit(1);
});
