'use strict';

/**
 * Catálogo de ponta a ponta, contra a API e o banco de verdade.
 *
 *   node testes/catalogo.test.js
 *
 * Cobre: leitura pública, árvore sem N+1, busca sem acento, CRUD com RBAC,
 * escopo negado, validação, remoção segura (409) e invalidação de cache.
 *
 * Todo registro criado aqui leva um sufixo único e é apagado no fim: o banco
 * `agropecas_dev` é compartilhado com outros módulos em construção.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');
const app = require(RAIZ + '/app');
const db = require(RAIZ + '/src/models');

/* o agregador `src/routes/index.js` é compartilhado entre módulos em paralelo
   e não pode ser editado por esta entrega. Montar o router aqui dá o mesmo
   caminho que ele terá em produção, e ainda antes do 404 e do handler de erro */
require(RAIZ + '/src/routes').use('/v1/catalogo', require(RAIZ + '/src/features/catalogo/catalogo.routes'));

let server, base;
const req = async (metodo, caminho, corpo, token) => {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

let passou = 0;
let falhou = 0;
const ok = (nome, cond, extra) => {
  if (cond) passou += 1;
  else falhou += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

const marcador = Date.now();
const criados = { categorias: [], marcas: [], maquinas: [], servicos: [], usuarios: [] };

/** cria conta pela API e devolve o token; papéis extras entram direto no banco */
async function conta({ admin = false } = {}) {
  const email = `cat${marcador}${Math.random().toString(36).slice(2, 7)}@agropecas.dev`;
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/registrar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nome: 'catalogo teste',
      email,
      senha: 'SenhaForte123',
      tipoPerfil: 'produtor',
      aceiteTermos: true,
      aceitePrivacidade: true,
    }),
  });
  const corpo = await r.json();
  const usuarioId = (await db.Usuario.findOne({ where: { email_normalizado: email } })).id;
  criados.usuarios.push(usuarioId);

  if (admin) {
    const papel = await db.Papel.findOne({ where: { chave: 'admin' } });
    await db.UsuarioPapel.create({ usuario_id: usuarioId, papel_id: papel.id });
    /* o token já emitido carrega só o `sub`; papéis são lidos do banco a cada
       requisição, então não é preciso reautenticar */
  }

  return { token: corpo.dados.tokens.acesso, usuarioId, email };
}

(async () => {
  await limparLimites();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1/catalogo`;

  const admin = await conta({ admin: true });
  const comum = await conta();

  console.log('\n— escrita exige RBAC —');
  let r = await req('POST', '/categorias', { nome: `Cat ${marcador}` });
  ok('criar sem token → 401', r.status === 401, r.corpo);
  r = await req('POST', '/categorias', { nome: `Cat ${marcador}` }, comum.token);
  ok('criar com usuário comum → 403', r.status === 403, r.corpo);
  r = await req('DELETE', `/marcas/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, null, comum.token);
  ok('remover com usuário comum → 403', r.status === 403, r.corpo);

  console.log('\n— categorias: CRUD —');
  r = await req('POST', '/categorias', { nome: `Peças de Trator ${marcador}`, tipo: 'peca', icone: 'wrench' }, admin.token);
  ok('cria categoria raiz → 201', r.status === 201, r.corpo);
  const raiz = r.corpo?.dados;
  criados.categorias.push(raiz.id);
  ok('gera slug sem acento', /^pecas-de-trator-\d+$/.test(raiz.slug), raiz.slug);
  ok('mapper não vaza colunas internas', !('removido_em' in raiz) && !('nome_normalizado' in raiz), Object.keys(raiz));

  r = await req('POST', '/categorias', { nome: `Bombas Hidráulicas ${marcador}`, parentId: raiz.id, tipo: 'peca' }, admin.token);
  ok('cria subcategoria → 201', r.status === 201, r.corpo);
  const filha = r.corpo?.dados;
  criados.categorias.push(filha.id);

  r = await req('POST', '/categorias', { nome: 'x', tipo: 'inexistente' }, admin.token);
  ok('validação agrega campos → 422', r.status === 422 && Object.keys(r.corpo.erro.detalhe.campos).length >= 2, r.corpo);

  r = await req('POST', '/categorias', { nome: `Peças de Trator ${marcador}` }, admin.token);
  ok('nome repetido gera slug novo, não colisão', r.status === 201 && r.corpo.dados.slug !== raiz.slug, r.corpo?.dados?.slug);
  if (r.status === 201) criados.categorias.push(r.corpo.dados.id);

  r = await req('PATCH', `/categorias/${filha.id}`, { descricao: 'bombas e reparos', ordem: 3 }, admin.token);
  ok('edita categoria → 200', r.status === 200 && r.corpo.dados.ordem === 3, r.corpo);
  ok('edição parcial não apaga o nome', r.corpo?.dados?.nome === filha.nome, r.corpo?.dados);

  r = await req('PATCH', `/categorias/${raiz.id}`, { parentId: filha.id }, admin.token);
  ok('mover pai para dentro da filha → 400 (ciclo)', r.status === 400, r.corpo);
  r = await req('PATCH', `/categorias/${raiz.id}`, { parentId: raiz.id }, admin.token);
  ok('ser pai de si mesma → 400', r.status === 400, r.corpo);

  console.log('\n— categorias: árvore pública —');
  r = await req('GET', '/categorias');
  ok('lista sem login → 200', r.status === 200, r.corpo);
  const noRaiz = (r.corpo?.dados || []).find((c) => c.id === raiz.id);
  ok('devolve árvore montada', !!noRaiz && Array.isArray(noRaiz.filhas), noRaiz);
  ok('subcategoria aparece dentro do pai', (noRaiz?.filhas || []).some((f) => f.id === filha.id), noRaiz?.filhas);

  /* uma única consulta para a árvore inteira: se voltar a ser N+1, o contador
     de SELECTs em `categorias` dispara junto com a quantidade de nós */
  let selects = 0;
  const espiao = (sql) => {
    if (/FROM "categorias"/i.test(sql)) selects += 1;
  };
  const loggingOriginal = db.sequelize.options.logging;
  db.sequelize.options.logging = espiao;
  const cacheModulo = require(RAIZ + '/src/features/catalogo/catalogo.cache');
  await cacheModulo.invalidarCategorias();
  await require(RAIZ + '/src/features/catalogo/catalogo.arvore.service').arvore({});
  db.sequelize.options.logging = loggingOriginal;
  ok('árvore custa 1 consulta (sem N+1)', selects === 1, selects);

  r = await req('GET', '/categorias?arvore=false&busca=bombas hidraulicas');
  ok('busca acento-insensível acha o acentuado', r.status === 200 && r.corpo.dados.some((c) => c.id === filha.id), r.corpo?.dados);
  ok('lista plana é paginada', !!r.corpo?.meta?.totalPaginas, r.corpo?.meta);

  r = await req('GET', `/categorias/${raiz.slug}`);
  ok('detalhe por slug → 200', r.status === 200 && r.corpo.dados.id === raiz.id, r.corpo);
  r = await req('GET', '/categorias/slug-que-nao-existe-' + marcador);
  ok('slug inexistente → 404', r.status === 404, r.corpo);

  console.log('\n— itens inativos só para quem gerencia —');
  await req('PATCH', `/categorias/${filha.id}`, { ativo: false }, admin.token);
  r = await req('GET', '/categorias?arvore=false&busca=bombas hidraulicas');
  ok('visitante não vê categoria inativa', !r.corpo.dados.some((c) => c.id === filha.id), r.corpo?.dados);
  r = await req('GET', '/categorias?arvore=false&busca=bombas hidraulicas&incluirInativas=true');
  ok('incluirInativas do visitante é ignorado', !r.corpo.dados.some((c) => c.id === filha.id), r.corpo?.dados);
  r = await req('GET', '/categorias?arvore=false&busca=bombas hidraulicas&incluirInativas=true', null, comum.token);
  ok('usuário comum também não vê inativa', !r.corpo.dados.some((c) => c.id === filha.id), r.corpo?.dados);
  r = await req('GET', '/categorias?arvore=false&busca=bombas hidraulicas&incluirInativas=true', null, admin.token);
  ok('Admin vê a inativa', r.corpo.dados.some((c) => c.id === filha.id), r.corpo?.dados);
  await req('PATCH', `/categorias/${filha.id}`, { ativo: true }, admin.token);

  console.log('\n— invalidação de cache na escrita —');
  await req('GET', '/categorias'); // aquece
  r = await req('POST', '/categorias', { nome: `Recem Criada ${marcador}` }, admin.token);
  const recem = r.corpo.dados;
  criados.categorias.push(recem.id);
  r = await req('GET', '/categorias');
  ok('categoria criada aparece na hora (cache invalidado)', r.corpo.dados.some((c) => c.id === recem.id), recem.id);

  console.log('\n— reordenação —');
  r = await req('PATCH', '/categorias/ordenar', { itens: [{ id: raiz.id, ordem: 10, destaque: true }, { id: filha.id, ordem: 20 }] }, admin.token);
  ok('reordena em lote → 200', r.status === 200 && r.corpo.dados.reordenadas === 2, r.corpo);
  r = await req('GET', `/categorias/${raiz.slug}`);
  ok('ordem e destaque persistiram', r.corpo.dados.ordem === 10 && r.corpo.dados.destaque === true, r.corpo?.dados);
  r = await req('PATCH', '/categorias/ordenar', { itens: [{ id: '11111111-1111-4111-8111-111111111111', ordem: 1 }] }, admin.token);
  ok('reordenar id inexistente → 400', r.status === 400, r.corpo);
  r = await req('PATCH', '/categorias/ordenar', { itens: [{ id: raiz.id, ordem: 1 }] }, comum.token);
  ok('reordenar sem permissão → 403', r.status === 403, r.corpo);

  console.log('\n— marcas —');
  r = await req('POST', '/marcas', { nome: `Böschtest ${marcador}`, tipo: 'peca' }, admin.token);
  ok('cria marca → 201', r.status === 201, r.corpo);
  const marca = r.corpo?.dados;
  criados.marcas.push(marca.id);
  r = await req('POST', '/marcas', { nome: `Böschtest ${marcador}` }, admin.token);
  ok('marca com nome idêntico → 409', r.status === 409, r.corpo);
  r = await req('GET', `/marcas?busca=boschtest ${marcador}`);
  ok('busca de marca sem acento acha a acentuada', r.status === 200 && r.corpo.dados.some((m) => m.id === marca.id), r.corpo?.dados);

  console.log('\n— máquinas —');
  r = await req('POST', '/maquinas', { marcaId: marca.id, modelo: `6110J ${marcador}`, categoriaMaquina: 'trator', anoInicio: 2012, anoFim: 2018, potenciaCv: 110 }, admin.token);
  ok('cria máquina → 201', r.status === 201, r.corpo);
  const maquina = r.corpo?.dados;
  criados.maquinas.push(maquina.id);
  ok('devolve a marca junto (sem segunda consulta no front)', maquina?.marca?.id === marca.id, maquina?.marca);
  r = await req('POST', '/maquinas', { marcaId: '11111111-1111-4111-8111-111111111111', modelo: 'X' + marcador }, admin.token);
  ok('marca inexistente → 400', r.status === 400, r.corpo);
  r = await req('POST', '/maquinas', { marcaId: marca.id, modelo: 'Y' + marcador, anoInicio: 2020, anoFim: 2010 }, admin.token);
  ok('ano final antes do inicial → 400', r.status === 400, r.corpo);
  r = await req('GET', `/maquinas?marcaId=${marca.id}`);
  ok('filtra máquina por marca', r.status === 200 && r.corpo.dados.length === 1 && r.corpo.dados[0].id === maquina.id, r.corpo?.dados);

  console.log('\n— serviços (lista provisória, gerenciável pelo Admin) —');
  r = await req('POST', '/servicos', { nome: `Manutenção Hidráulica ${marcador}`, categoriaId: raiz.id }, admin.token);
  ok('categoria de peça não agrupa serviço → 400', r.status === 400, r.corpo);
  r = await req('POST', '/categorias', { nome: `Serviços Agrícolas ${marcador}`, tipo: 'servico' }, admin.token);
  const catServico = r.corpo.dados;
  criados.categorias.push(catServico.id);
  r = await req('POST', '/servicos', { nome: `Manutenção Hidráulica ${marcador}`, categoriaId: catServico.id, ordem: 1 }, admin.token);
  ok('cria serviço → 201', r.status === 201, r.corpo);
  const servico = r.corpo?.dados;
  criados.servicos.push(servico.id);
  ok('serviço traz a categoria', servico?.categoria?.id === catServico.id, servico?.categoria);
  r = await req('GET', '/servicos?busca=manutencao hidraulica');
  ok('serviço é público e busca sem acento', r.status === 200 && r.corpo.dados.some((s) => s.id === servico.id), r.corpo?.dados);
  r = await req('PATCH', '/servicos/ordenar', { itens: [{ id: servico.id, ordem: 7 }] }, admin.token);
  ok('reordena serviços → 200', r.status === 200, r.corpo);

  console.log('\n— remoção segura —');
  r = await req('DELETE', `/categorias/${raiz.id}`, null, admin.token);
  ok('categoria com subcategoria → 409', r.status === 409, r.corpo);
  ok('409 explica o que trava e sugere desativar', r.corpo?.erro?.detalhe?.sugestao === 'ativo: false', r.corpo?.erro?.detalhe);

  /* o vetor real do módulo: apagar uma categoria com anúncio a FK é SET NULL,
     então o banco deixaria passar e os anúncios sumiriam de todo filtro */
  const dono = await db.Perfil.findOne({ where: { usuario_id: comum.usuarioId } });
  const anuncio = await db.Anuncio.create({
    codigo: `T-${String(marcador).slice(-8)}`,
    usuario_id: comum.usuarioId,
    perfil_id: dono.id,
    categoria_id: recem.id,
    tipo: 'peca',
    titulo: `Anuncio de teste ${marcador}`,
    titulo_normalizado: `anuncio de teste ${marcador}`,
    slug: `anuncio-de-teste-${marcador}`,
    descricao: 'teste de vinculo',
    /* o schema exige preço OU "a combinar" (ck_anuncios_preco_ou_combinar) */
    preco_a_combinar: true,
    status: 'rascunho',
  });
  r = await req('DELETE', `/categorias/${recem.id}`, null, admin.token);
  ok('categoria com anúncio vinculado → 409', r.status === 409 && r.corpo.erro.detalhe.anuncios === 1, r.corpo);
  await anuncio.destroy({ force: true });

  r = await req('DELETE', `/marcas/${marca.id}`, null, admin.token);
  ok('marca com máquina → 409', r.status === 409 && r.corpo.erro.detalhe.maquinas === 1, r.corpo);

  await db.PerfilServico.create({ perfil_id: dono.id, servico_id: servico.id });
  r = await req('DELETE', `/servicos/${servico.id}`, null, admin.token);
  ok('serviço declarado por prestador → 409', r.status === 409 && r.corpo.erro.detalhe.prestadores === 1, r.corpo);
  await db.PerfilServico.destroy({ where: { servico_id: servico.id } });

  r = await req('DELETE', `/servicos/${servico.id}`, null, admin.token);
  ok('serviço livre → 200', r.status === 200, r.corpo);
  r = await req('DELETE', `/maquinas/${maquina.id}`, null, admin.token);
  ok('máquina sem anúncio → 200', r.status === 200, r.corpo);
  r = await req('DELETE', `/marcas/${marca.id}`, null, admin.token);
  ok('marca livre depois da máquina → 200', r.status === 200, r.corpo);
  r = await req('DELETE', `/marcas/${marca.id}`, null, admin.token);
  ok('remover duas vezes → 404', r.status === 404, r.corpo);

  console.log('\n— auditoria —');
  const logs = await db.LogAuditoria.count({ where: { entidade: 'categorias' } });
  ok('escrita no catálogo grava auditoria', logs > 0, logs);

  console.log('\n— limpeza —');
  await db.Servico.destroy({ where: { id: criados.servicos }, force: true });
  await db.Maquina.destroy({ where: { id: criados.maquinas }, force: true });
  await db.Marca.destroy({ where: { id: criados.marcas }, force: true });
  /* filhas antes das raízes: a FK é SET NULL, mas apagar na ordem evita
     deixar registro órfão se algo falhar no meio */
  await db.Categoria.destroy({ where: { parent_id: criados.categorias }, force: true });
  await db.Categoria.destroy({ where: { id: criados.categorias }, force: true });
  console.log('  --  registros de teste removidos');

  console.log(`\n${passou} ok · ${falhou} falha(s)`);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
  process.exit(falhou ? 1 : 0);
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
