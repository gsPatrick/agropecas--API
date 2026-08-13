'use strict';

/**
 * Painel administrativo — catálogo (`/admin/catalogo/:colecao`).
 *
 *   node testes/admin.catalogo.test.js
 *
 * O vetor de segurança específico deste módulo está no fim do arquivo: a rota
 * carrega UMA permissão genérica (`categoria.criar`), e é o service que exige
 * a permissão da COLEÇÃO. Sem essa checagem, quem pode criar categoria criaria
 * marca, máquina e serviço — escalada silenciosa dentro de uma rota que parece
 * autorizada. O teste do curador é o que prova que ela existe.
 *
 * Sobre montar o app aqui em vez de usar `../app`: ver `testes/apoio.admin.js`.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');
const { montarApp, clienteEm, registrar, comPapel, papelPorChave } = require('./apoio.admin');
const db = require(RAIZ + '/src/models');

let req;
let passou = 0;
let falhou = 0;
const ok = (nome, cond, extra) => {
  if (cond) passou += 1;
  else falhou += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

/**
 * Papel de teste com um recorte estreito de permissões.
 *
 * É a única forma honesta de testar a checagem por coleção: com o papel
 * `admin` o coringa `*` passa em tudo e o teste não provaria nada.
 */
async function papelCurador(chaves) {
  const chave = `teste_curador_${Date.now()}`;
  const papel = await db.Papel.create({ chave, nome: 'Curador de teste', sistema: false });

  const permissoes = await db.Permissao.findAll({ where: { chave: chaves } });
  if (permissoes.length !== chaves.length) {
    const achadas = permissoes.map((p) => p.chave);
    throw new Error('permissões ausentes: ' + chaves.filter((c) => !achadas.includes(c)).join(', '));
  }

  await db.PapelPermissao.bulkCreate(
    permissoes.map((permissao) => ({ papel_id: papel.id, permissao_id: permissao.id }))
  );

  return papel;
}

(async () => {
  await limparLimites();
  const servidor = montarApp().listen(0);
  req = clienteEm('http://127.0.0.1:' + servidor.address().port + '/api/v1');

  const marca = Date.now();
  const comum = await registrar(req, 'catcomum');
  const adminConta = await registrar(req, 'catadmin');
  const tokenAdmin = await comPapel(req, adminConta, (await papelPorChave('admin')).id);

  console.log('\n— usuário comum não entra no catálogo do painel —');
  for (const [metodo, caminho, corpo] of [
    ['GET', '/admin/catalogo/categorias'],
    ['POST', '/admin/catalogo/marcas', { nome: 'Marca Pirata' }],
    ['DELETE', '/admin/catalogo/marcas/00000000-0000-4000-8000-000000000000'],
  ]) {
    const r = await req(metodo, caminho, corpo, comum.token);
    ok(`${metodo} ${caminho} → 403 para usuário comum`, r.status === 403, r.status);
  }

  console.log('\n— coleções —');
  let r = await req('GET', '/admin/catalogo/inventadas', null, tokenAdmin);
  ok('coleção inexistente → 422 (esquema de params)', r.status === 422, r.status);

  for (const colecao of ['categorias', 'marcas', 'maquinas', 'servicos']) {
    r = await req(`GET`, `/admin/catalogo/${colecao}?porPagina=5`, null, tokenAdmin);
    ok(`lista ${colecao} → 200 paginado`, r.status === 200 && Array.isArray(r.corpo.dados), r.corpo);
  }

  r = await req('GET', '/admin/catalogo/marcas?porPagina=9999', null, tokenAdmin);
  ok('porPagina acima do teto → recusado pelo esquema', r.status === 422, r.status);

  console.log('\n— escrita —');
  r = await req('POST', '/admin/catalogo/categorias', { nome: `Categoria Teste ${marca}`, tipo: 'peca' }, tokenAdmin);
  ok('cria categoria → 201', r.status === 201, r.corpo);
  const categoriaId = r.corpo?.dados?.id;

  r = await req('POST', '/admin/catalogo/marcas', { nome: `Marca Teste ${marca}`, tipo: 'ambos' }, tokenAdmin);
  ok('cria marca → 201', r.status === 201, r.corpo);
  const marcaId = r.corpo?.dados?.id;

  const auditCriacao = await db.LogAuditoria.findOne({
    where: { entidade: 'marcas', entidade_id: marcaId, acao: 'criar' },
  });
  ok('criação de item do catálogo é auditada', !!auditCriacao, marcaId);

  r = await req('PATCH', `/admin/catalogo/marcas/${marcaId}`, { nome: `Marca Teste ${marca} v2` }, tokenAdmin);
  ok('edita marca → 200', r.status === 200 && r.corpo.dados.nome.endsWith('v2'), r.corpo);

  /**
   * ⚠️ DEFEITO CONHECIDO, no mapa de rotas (arquivo proibido para este módulo).
   *
   * `PATCH /catalogo/:colecao/ordenar` está declarado DEPOIS de
   * `PATCH /catalogo/:colecao/:id`: o Express casa a rota anterior e o
   * `validar.params(colecaoItem)` recusa "ordenar" como id (422) antes de o
   * controller rodar. O desvio previsto em `admin.catalogo.controller.js` só
   * entra em ação quando a ordem das duas linhas for corrigida.
   *
   * Este teste registra o comportamento ATUAL, para que a correção apareça
   * como teste que passa a falhar — e exercita a regra pelo service, que é
   * onde ela vive.
   */
  r = await req('PATCH', `/admin/catalogo/categorias/ordenar`, { itens: [{ id: categoriaId, ordem: 3 }] }, tokenAdmin);
  ok('rota /ordenar hoje é engolida por /:id (defeito reportado)', r.status === 422, r.status);

  const catalogoService = require(RAIZ + '/src/features/admin/services/admin.catalogo.service');
  const contextoAdmin = { autenticado: true, usuarioId: adminConta.id, papeis: ['admin'], permissoes: new Set(), admin: true };

  await catalogoService.ordenar(contextoAdmin, 'categorias', [{ id: categoriaId, ordem: 3 }]);
  const recarregada = await db.Categoria.findByPk(categoriaId);
  ok('service reordena categorias de verdade', recarregada?.ordem === 3, recarregada?.ordem);

  const semOrdem = await catalogoService
    .ordenar(contextoAdmin, 'marcas', [{ id: marcaId, ordem: 1 }])
    .then(() => null)
    .catch((erro) => erro);
  ok('marca não tem ordenação manual → 400', semOrdem?.statusCode === 400, semOrdem?.message);

  r = await req('DELETE', `/admin/catalogo/marcas/${marcaId}`, null, tokenAdmin);
  ok('remove marca sem vínculos → 200', r.status === 200, r.corpo);

  r = await req('DELETE', `/admin/catalogo/categorias/${categoriaId}`, null, tokenAdmin);
  ok('remove categoria sem vínculos → 200', r.status === 200, r.corpo);

  console.log('\n— ESCOPO POR COLEÇÃO: quem pode categoria NÃO cria marca —');
  const curadorConta = await registrar(req, 'curador');
  const papel = await papelCurador([
    'admin.acessar',
    'categoria.criar',
    'categoria.editar',
    'categoria.remover',
  ]);
  const tokenCurador = await comPapel(req, curadorConta, papel.id);

  r = await req('POST', '/admin/catalogo/categorias', { nome: `Categoria Curador ${marca}`, tipo: 'peca' }, tokenCurador);
  ok('curador cria categoria → 201', r.status === 201, r.corpo);
  const categoriaCurador = r.corpo?.dados?.id;

  r = await req('POST', '/admin/catalogo/marcas', { nome: `Marca Curador ${marca}` }, tokenCurador);
  ok('curador NÃO cria marca → 403', r.status === 403, r.corpo);
  ok('e o 403 nomeia a permissão que falta', r.corpo?.erro?.detalhe?.permissao === 'marca.criar', r.corpo?.erro?.detalhe);

  r = await req('POST', '/admin/catalogo/maquinas', { modelo: `Modelo Curador ${marca}` }, tokenCurador);
  ok('curador NÃO cria máquina → 403', r.status === 403, r.status);

  r = await req('POST', '/admin/catalogo/servicos', { nome: `Serviço Curador ${marca}` }, tokenCurador);
  ok('curador NÃO cria serviço → 403', r.status === 403, r.status);

  r = await req('GET', '/admin/catalogo/marcas', null, tokenCurador);
  ok('curador nem LISTA marcas do painel → 403', r.status === 403, r.status);

  const marcaCriada = await db.Marca.findOne({ where: { nome: `Marca Curador ${marca}` } });
  ok('nenhuma marca foi criada pelo curador', !marcaCriada, marcaCriada?.id);

  /* faxina: o papel de teste não pode ficar no banco competindo com os reais */
  if (categoriaCurador) await req('DELETE', `/admin/catalogo/categorias/${categoriaCurador}`, null, tokenAdmin);
  await db.PapelPermissao.destroy({ where: { papel_id: papel.id } });
  await db.UsuarioPapel.destroy({ where: { papel_id: papel.id } });
  await db.Papel.destroy({ where: { id: papel.id } });

  console.log(`\n${passou} ok · ${falhou} falha(s)`);

  servidor.close();
  await encerrarInfra();
  process.exit(falhou ? 1 : 0);
})().catch(async (erro) => {
  console.error(erro);
  await encerrarInfra().catch(() => null);
  process.exit(1);
});
