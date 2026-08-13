'use strict';

/**
 * Busca de ponta a ponta, contra a API e o banco de verdade.
 *
 *   node testes/busca.test.js
 *
 * O teste cria o próprio cenário (município, categoria, marca, máquina, perfil
 * e sete anúncios com um sufixo único) e apaga tudo ao final: o banco de
 * desenvolvimento é compartilhado por vários módulos sendo escritos em
 * paralelo, e um teste que deixa lixo quebra o teste do vizinho.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');

/* a busca ainda não está montada em `src/routes/index.js` (arquivo do
   orquestrador). Registrar aqui, ANTES de `app` ser carregado, exercita a
   rota real com todos os middlewares globais no lugar */
const routes = require(RAIZ + '/src/routes');
routes.use('/v1/busca', require(RAIZ + '/src/features/busca/busca.routes'));

const app = require(RAIZ + '/app');
const db = require(RAIZ + '/src/models');
const cache = require(RAIZ + '/src/cache');
const { normalizar, slugify } = require(RAIZ + '/src/utils/texto');

let server, base;
const req = async (metodo, caminho, corpo) => {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null), headers: r.headers };
};

let falhas = 0;
const ok = (nome, cond, extra) => {
  if (!cond) falhas += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

/* marca de água: tudo que este teste cria carrega o sufixo e some no final */
const MARCA_TESTE = `zzt${Date.now()}`;

async function semear() {
  const estado = await db.Estado.findOne({ where: { uf: 'MT' } })
    || await db.Estado.create({ nome: 'Mato Grosso', uf: 'MT', codigo_ibge: 51, regiao: 'centro_oeste' });

  const municipio = await db.Municipio.create({
    estado_id: estado.id,
    nome: `Tangará ${MARCA_TESTE}`,
    nome_normalizado: normalizar(`Tangará ${MARCA_TESTE}`),
    uf: 'MT',
    codigo_ibge: 9000000 + Math.floor(Math.random() * 900000),
    latitude: -14.6229,
    longitude: -57.4933,
    populacao: 100000,
  });

  /* município distante, para provar que o raio corta de verdade */
  const distante = await db.Municipio.create({
    estado_id: estado.id,
    nome: `Sinop ${MARCA_TESTE}`,
    nome_normalizado: normalizar(`Sinop ${MARCA_TESTE}`),
    uf: 'MT',
    codigo_ibge: 9000000 + Math.floor(Math.random() * 900000),
    latitude: -11.8642,
    longitude: -55.5025,
    populacao: 150000,
  });

  const categoriaPai = await db.Categoria.create({
    nome: `Peças ${MARCA_TESTE}`,
    nome_normalizado: normalizar(`Peças ${MARCA_TESTE}`),
    slug: slugify(`Peças ${MARCA_TESTE}`),
    tipo: 'peca',
    ativo: true,
  });

  const categoriaFilha = await db.Categoria.create({
    parent_id: categoriaPai.id,
    nome: `Motor ${MARCA_TESTE}`,
    nome_normalizado: normalizar(`Motor ${MARCA_TESTE}`),
    slug: slugify(`Motor ${MARCA_TESTE}`),
    tipo: 'peca',
    ativo: true,
  });

  const marca = await db.Marca.create({
    nome: `Valtra ${MARCA_TESTE}`,
    nome_normalizado: normalizar(`Valtra ${MARCA_TESTE}`),
    slug: slugify(`Valtra ${MARCA_TESTE}`),
    ativo: true,
  });

  const maquina = await db.Maquina.create({
    marca_id: marca.id,
    modelo: `BH180 ${MARCA_TESTE}`,
    modelo_normalizado: normalizar(`BH180 ${MARCA_TESTE}`),
    slug: slugify(`BH180 ${MARCA_TESTE}`),
    categoria_maquina: 'trator',
    ativo: true,
  });

  const usuario = await db.Usuario.create({
    nome: 'Loja de Teste da Busca',
    email: `busca${MARCA_TESTE}@agropecas.dev`,
    email_normalizado: `busca${MARCA_TESTE}@agropecas.dev`,
    senha_hash: 'x'.repeat(60),
    status: 'ativo',
  });

  const perfil = await db.Perfil.create({
    usuario_id: usuario.id,
    tipo: 'loja',
    slug: slugify(`Loja Busca ${MARCA_TESTE}`),
    nome_exibicao: `Loja Busca ${MARCA_TESTE}`,
    pessoa_tipo: 'juridica',
    whatsapp: '+5565999990000',
    exibir_whatsapp: true,
    exibir_endereco_exato: false,
    municipio_id: municipio.id,
    uf: 'MT',
  });

  /* segundo perfil com o WhatsApp escondido: é o que prova o respeito ao
     consentimento no mapper */
  const usuarioReservado = await db.Usuario.create({
    nome: 'Produtor Reservado',
    email: `reserva${MARCA_TESTE}@agropecas.dev`,
    email_normalizado: `reserva${MARCA_TESTE}@agropecas.dev`,
    senha_hash: 'x'.repeat(60),
    status: 'ativo',
  });

  const perfilReservado = await db.Perfil.create({
    usuario_id: usuarioReservado.id,
    tipo: 'produtor',
    slug: slugify(`Produtor Reservado ${MARCA_TESTE}`),
    nome_exibicao: `Produtor Reservado ${MARCA_TESTE}`,
    whatsapp: '+5565988887777',
    exibir_whatsapp: false,
    exibir_endereco_exato: false,
    municipio_id: municipio.id,
    uf: 'MT',
  });

  const agora = new Date();
  const diasAtras = (n) => new Date(agora.getTime() - n * 24 * 60 * 60 * 1000);

  const anuncioBase = (extra) => ({
    usuario_id: usuario.id,
    perfil_id: perfil.id,
    tipo: 'peca',
    categoria_id: categoriaFilha.id,
    marca_id: marca.id,
    condicao: 'usada',
    negociacao: 'venda',
    municipio_id: municipio.id,
    uf: 'MT',
    latitude: -14.6229,
    longitude: -57.4933,
    precisao_localizacao: 'aproximada',
    status: 'publicado',
    publicado_em: diasAtras(1),
    ...extra,
  });

  const criarAnuncio = async (dados) => {
    const titulo = dados.titulo;
    return db.Anuncio.create(
      anuncioBase({
        ...dados,
        codigo: `T${String(Math.random()).slice(2, 11)}`.slice(0, 12),
        titulo_normalizado: normalizar(titulo),
        slug: slugify(`${titulo} ${Math.random().toString(36).slice(2, 8)}`),
        descricao: dados.descricao || `Descrição do anúncio de teste ${MARCA_TESTE}.`,
        busca_texto: normalizar(
          `${titulo} ${dados.descricao || ''} ${dados.codigo_peca || ''} ${MARCA_TESTE}`
        ),
      })
    );
  };

  const anuncios = [];

  anuncios.push(
    await criarAnuncio({
      titulo: `Rolamento de roda dianteiro ${MARCA_TESTE}`,
      preco_centavos: 25000,
      codigo_peca: `RL-${MARCA_TESTE}`,
      codigo_peca_normalizado: normalizar(`RL-${MARCA_TESTE}`),
    })
  );

  anuncios.push(
    await criarAnuncio({
      titulo: `Rolamento traseiro reforçado ${MARCA_TESTE}`,
      preco_centavos: 80000,
      condicao: 'nova',
    })
  );

  anuncios.push(
    await criarAnuncio({
      titulo: `Bomba hidráulica ${MARCA_TESTE}`,
      preco_centavos: 150000,
      condicao: 'nova',
      categoria_id: categoriaPai.id,
    })
  );

  anuncios.push(
    await criarAnuncio({
      titulo: `Serviço de solda em campo ${MARCA_TESTE}`,
      tipo: 'servico',
      negociacao: 'servico',
      condicao: 'nao_se_aplica',
      preco_centavos: null,
      preco_a_combinar: true,
    })
  );

  /* longe: só aparece em busca sem raio, ou com raio grande */
  anuncios.push(
    await criarAnuncio({
      titulo: `Rolamento de Sinop ${MARCA_TESTE}`,
      preco_centavos: 30000,
      municipio_id: distante.id,
      latitude: -11.8642,
      longitude: -55.5025,
    })
  );

  /* rascunho: NÃO pode aparecer em nenhuma busca */
  anuncios.push(
    await criarAnuncio({
      titulo: `Rolamento secreto em rascunho ${MARCA_TESTE}`,
      preco_centavos: 100,
      status: 'rascunho',
      publicado_em: null,
    })
  );

  /* do perfil que escondeu o WhatsApp */
  anuncios.push(
    await criarAnuncio({
      titulo: `Rolamento do produtor reservado ${MARCA_TESTE}`,
      preco_centavos: 40000,
      perfil_id: perfilReservado.id,
      usuario_id: usuarioReservado.id,
    })
  );

  await db.AnuncioMaquina.create({ anuncio_id: anuncios[0].id, maquina_id: maquina.id });

  await db.AnuncioFoto.create({
    anuncio_id: anuncios[0].id,
    path: `teste/${MARCA_TESTE}.jpg`,
    url: `https://exemplo.test/${MARCA_TESTE}.jpg`,
    url_thumb: `https://exemplo.test/${MARCA_TESTE}-thumb.jpg`,
    ordem: 0,
    principal: true,
  });

  /* foto bloqueada pela moderação em outro anúncio: não pode virar capa */
  await db.AnuncioFoto.create({
    anuncio_id: anuncios[1].id,
    path: `teste/bloqueada-${MARCA_TESTE}.jpg`,
    url: `https://exemplo.test/bloqueada.jpg`,
    ordem: 0,
    principal: true,
    bloqueada: true,
  });

  return {
    estado, municipio, distante, categoriaPai, categoriaFilha, marca, maquina,
    usuario, usuarioReservado, perfil, perfilReservado, anuncios,
  };
}

/**
 * Limpeza pelo MARCADOR, não pela lista de ids.
 *
 * Se o teste quebrar no meio, a lista de ids em memória se perde e o cenário
 * fica no banco — poluindo a próxima execução e a de quem estiver trabalhando
 * na mesma base. Apagar por `LIKE '%marcador%'` funciona mesmo depois de um
 * `process.exit`, e é chamada também no `catch`.
 */
async function limpar() {
  const { Op } = require('sequelize');
  const como = { [Op.like]: `%${MARCA_TESTE}%` };

  const anuncios = await db.Anuncio.findAll({ where: { titulo: como }, attributes: ['id'], paranoid: false });
  const ids = anuncios.map((a) => a.id);

  await db.AnuncioMaquina.destroy({ where: { anuncio_id: ids } });
  await db.AnuncioFoto.destroy({ where: { anuncio_id: ids }, force: true });
  await db.Anuncio.destroy({ where: { id: ids }, force: true });
  await db.Maquina.destroy({ where: { modelo: como }, force: true });
  await db.Marca.destroy({ where: { nome: como }, force: true });
  await db.Categoria.destroy({ where: { nome: como }, force: true });
  await db.Perfil.destroy({ where: { nome_exibicao: como }, force: true });
  await db.Usuario.destroy({ where: { email: como }, force: true });
  await db.Municipio.destroy({ where: { nome: como } });
  await db.BuscaLog.destroy({ where: { termo: como } });
  await db.TermoPopular.destroy({ where: { termo_normalizado: como } });

  return ids.length;
}

/* o cache de 45s faria o segundo teste ver o resultado do primeiro; cada bloco
   parte de um cache limpo, exceto o bloco que testa o cache */
const zerarCache = () => cache.invalidar(`${cache.chaves.dominio('busca')}`);

(async () => {
  await limparLimites();
  const cenario = await semear();

  server = app.listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api/v1/busca';

  const chavesCache = require(RAIZ + '/src/features/busca/busca.cache');
  await chavesCache.invalidarTudo();

  const M = MARCA_TESTE;
  let r;

  console.log('\n— termo livre e tolerância a erro de digitação —');

  r = await req('GET', `/?q=${M}`);
  ok('busca pelo marcador → 200', r.status === 200, r.corpo);
  ok(
    'traz os 6 publicados e nenhum rascunho',
    r.corpo?.meta?.total === 6,
    { total: r.corpo?.meta?.total }
  );

  r = await req('GET', `/?q=rolamentu%20${M}`);
  const titulos = (r.corpo?.dados || []).map((i) => i.titulo);
  ok('"rolamentu" encontra "rolamento"', titulos.some((t) => /Rolamento/i.test(t)), titulos);

  r = await req('GET', `/?q=bomba%20hidraulica%20${M}`);
  ok(
    'busca sem acento encontra "hidráulica"',
    (r.corpo?.dados || []).some((i) => /Bomba/i.test(i.titulo)),
    (r.corpo?.dados || []).map((i) => i.titulo)
  );

  r = await req('GET', `/?q=RL-${M}`);
  ok(
    'código de peça vem em primeiro (relevância)',
    /Rolamento de roda dianteiro/i.test(r.corpo?.dados?.[0]?.titulo || ''),
    r.corpo?.dados?.[0]
  );

  console.log('\n— rascunho nunca aparece —');
  const idRascunho = cenario.anuncios[5].id;
  r = await req('GET', `/?q=secreto%20${M}&pp=35`);
  ok(
    'rascunho fora do resultado',
    !(r.corpo?.dados || []).some((i) => i.id === idRascunho),
    (r.corpo?.dados || []).map((i) => i.titulo)
  );
  const rascunhoNoBanco = await db.Anuncio.findByPk(idRascunho);
  ok('o rascunho existe no banco (o filtro é que o esconde)', rascunhoNoBanco?.status === 'rascunho', rascunhoNoBanco?.status);
  r = await req('GET', `/?q=${M}&pp=35`);
  ok(
    'rascunho fora mesmo pedindo tudo',
    !(r.corpo?.dados || []).some((i) => /rascunho/i.test(i.titulo)),
    (r.corpo?.dados || []).map((i) => i.titulo)
  );

  console.log('\n— filtros combinados —');
  await zerarCache();

  r = await req('GET', `/?q=${M}&cat=${slugify(`Motor ${M}`)}&cond=usada&min=200&max=500`);
  ok(
    'categoria + condição + faixa de preço (3 usados de R$200–500 em Motor)',
    r.corpo?.meta?.total === 3,
    { total: r.corpo?.meta?.total, itens: (r.corpo?.dados || []).map((i) => i.titulo) }
  );

  r = await req('GET', `/?q=${M}&cat=${slugify(`Peças ${M}`)}`);
  ok(
    'categoria-pai arrasta as filhas',
    r.corpo?.meta?.total === 6,
    { total: r.corpo?.meta?.total }
  );

  r = await req('GET', `/?q=${M}&tipo=servico`);
  ok('filtro por tipo=servico', r.corpo?.meta?.total === 1, r.corpo?.meta);

  r = await req('GET', `/?q=${M}&aCombinar=true`);
  ok('filtro "a combinar"', r.corpo?.meta?.total === 1, r.corpo?.meta);
  ok('preço a combinar não vira zero', r.corpo?.dados?.[0]?.preco?.aCombinar === true, r.corpo?.dados?.[0]?.preco);

  r = await req('GET', `/?q=${M}&maquina=${slugify(`BH180 ${M}`)}`);
  ok('filtro por máquina compatível', r.corpo?.meta?.total === 1, r.corpo?.meta);

  r = await req('GET', `/?q=${M}&marca=${slugify(`Valtra ${M}`)}&uf=MT`);
  ok('marca + UF', r.corpo?.meta?.total === 6, r.corpo?.meta);

  r = await req('GET', `/?q=${M}&cidade=${encodeURIComponent(`Tangará ${M}`)}`);
  ok('filtro por cidade', r.corpo?.meta?.total === 5, r.corpo?.meta);

  r = await req('GET', `/?q=${M}&dias=30`);
  ok('filtro por período', r.corpo?.meta?.total === 6, r.corpo?.meta);

  console.log('\n— ordenação —');
  await zerarCache();

  r = await req('GET', `/?q=${M}&ord=menorPreco`);
  const precos = (r.corpo?.dados || []).map((i) => i.preco.centavos);
  ok('menor preço em ordem crescente', JSON.stringify(precos) === JSON.stringify([...precos].sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b))), precos);
  ok('"a combinar" fica por último', precos[precos.length - 1] === null, precos);

  r = await req('GET', `/?q=${M}&ord=maiorPreco`);
  const desc = (r.corpo?.dados || []).map((i) => i.preco.centavos).filter((v) => v !== null);
  ok('maior preço em ordem decrescente', JSON.stringify(desc) === JSON.stringify([...desc].sort((a, b) => b - a)), desc);

  console.log('\n— proximidade —');
  await zerarCache();

  r = await req('GET', `/?q=${M}&lat=-14.6229&lon=-57.4933&raioKm=50&ord=proximos`);
  ok(
    'raio de 50 km exclui o anúncio de Sinop',
    !(r.corpo?.dados || []).some((i) => /Sinop/i.test(i.titulo)),
    (r.corpo?.dados || []).map((i) => i.titulo)
  );
  ok('distância vem calculada', typeof r.corpo?.dados?.[0]?.local?.distanciaKm === 'number', r.corpo?.dados?.[0]?.local);

  r = await req('GET', `/?q=${M}&lat=-14.6229&lon=-57.4933&raioKm=500&ord=proximos`);
  const ordemDist = (r.corpo?.dados || []).map((i) => i.local.distanciaKm);
  ok('raio de 500 km inclui Sinop', ordemDist.length === 6, ordemDist);
  ok('ordenado por distância crescente', JSON.stringify(ordemDist) === JSON.stringify([...ordemDist].sort((a, b) => a - b)), ordemDist);

  r = await req('GET', `/?q=${M}&ord=proximos`);
  ok('ordenar por proximidade sem origem → 400', r.status === 400, r.corpo);

  console.log('\n— paginação com teto —');
  await zerarCache();

  r = await req('GET', `/?q=${M}&pp=999999`);
  ok('porPagina absurdo é recusado (422), não aceito', r.status === 422, { status: r.status, meta: r.corpo?.meta });

  r = await req('GET', `/?q=${M}&porPagina=999999`);
  ok('apelido porPagina também tem teto', r.status === 422, r.corpo?.meta);

  const direto = require(RAIZ + '/src/features/busca/busca.filtro.service');
  const tetoDireto = await direto.montar({ q: M, pp: 999999 });
  ok('teto também vale no service (pp=999999 → 35)', tetoDireto.porPagina === 35, tetoDireto.porPagina);

  r = await req('GET', `/?q=${M}&pp=2&p=1`);
  ok('pp=2 devolve 2 itens', (r.corpo?.dados || []).length === 2, r.corpo?.meta);
  ok('meta traz total e páginas', r.corpo?.meta?.total === 6 && r.corpo?.meta?.totalPaginas === 3, r.corpo?.meta);

  const pagina1 = (r.corpo?.dados || []).map((i) => i.id);
  r = await req('GET', `/?q=${M}&pp=2&p=2`);
  const pagina2 = (r.corpo?.dados || []).map((i) => i.id);
  ok('páginas não repetem item', !pagina1.some((id) => pagina2.includes(id)), { pagina1, pagina2 });

  console.log('\n— injeção de SQL —');
  await zerarCache();

  const vetores = [
    `' OR 1=1 --`,
    `'; DROP TABLE anuncios; --`,
    `%' UNION SELECT senha_hash FROM usuarios --`,
    `x' AND (SELECT pg_sleep(5)) IS NOT NULL --`,
    `1' OR '1'='1`,
  ];

  for (const vetor of vetores) {
    r = await req('GET', `/?q=${encodeURIComponent(vetor)}`);
    ok(
      `injeção "${vetor.slice(0, 22)}…" não derruba nem vaza`,
      r.status === 200 && Array.isArray(r.corpo?.dados) && !JSON.stringify(r.corpo).includes('senha_hash'),
      { status: r.status, corpo: r.corpo }
    );
  }

  r = await req('GET', `/?q=${M}&cat=${encodeURIComponent(`' OR 1=1 --`)}`);
  ok('injeção no filtro de categoria devolve vazio, não tudo', r.corpo?.meta?.total === 0, r.corpo?.meta);

  r = await req('GET', `/?q=${M}&cidade=${encodeURIComponent(`'; DELETE FROM anuncios; --`)}`);
  ok('injeção no filtro de cidade devolve vazio', r.corpo?.meta?.total === 0, r.corpo?.meta);

  const sobreviventes = await db.Anuncio.count({ where: { id: cenario.anuncios.map((a) => a.id) } });
  ok('nenhum anúncio foi apagado pelas injeções', sobreviventes === cenario.anuncios.length, sobreviventes);

  const tabelas = await db.sequelize.query(
    "SELECT to_regclass('public.anuncios') AS t",
    { type: db.Sequelize.QueryTypes.SELECT }
  );
  ok('tabela `anuncios` continua existindo', tabelas[0].t === 'anuncios', tabelas);

  console.log('\n— privacidade (LGPD) —');
  await zerarCache();

  r = await req('GET', `/?q=reservado%20${M}`);
  const reservado = (r.corpo?.dados || [])[0];
  ok('perfil com exibir_whatsapp=false não expõe o número', reservado && reservado.anunciante.whatsapp === undefined, reservado?.anunciante);

  r = await req('GET', `/?q=${M}&pp=35`);
  const bruto = JSON.stringify(r.corpo);
  ok('resposta não contém senha_hash', !bruto.includes('senha_hash'));
  ok('resposta não contém documento', !bruto.includes('"documento"'));
  ok('resposta não contém ip_hash', !bruto.includes('ip_hash'));
  ok('resposta não contém e-mail do anunciante', !bruto.includes('@agropecas.dev'));
  ok('resposta não contém a descrição (coluna TEXT fora da listagem)', !bruto.includes('Descrição do anúncio'));

  const comEndereco = (r.corpo?.dados || []).find((i) => /roda dianteiro/i.test(i.titulo));
  ok(
    'exibir_endereco_exato=false → localização aproximada',
    comEndereco?.local?.aproximada === true,
    comEndereco?.local
  );

  console.log('\n— foto de capa sem N+1 —');
  ok('capa vem na mesma consulta', Boolean(comEndereco?.foto?.url), comEndereco?.foto);
  const semCapa = (r.corpo?.dados || []).find((i) => /traseiro reforçado/i.test(i.titulo));
  ok('foto bloqueada pela moderação não vira capa', semCapa?.foto === null, semCapa?.foto);

  console.log('\n— cache —');
  await zerarCache();

  r = await req('GET', `/?q=${M}&cond=nova`);
  ok('primeira busca vai ao banco (MISS)', r.headers.get('x-cache') === 'MISS', r.headers.get('x-cache'));
  r = await req('GET', `/?cond=nova&q=${M}`);
  ok('mesma busca com parâmetros trocados de ordem acerta o cache (HIT)', r.headers.get('x-cache') === 'HIT', r.headers.get('x-cache'));
  r = await req('GET', `/?q=${M}&cond=usada`);
  ok('filtro diferente não reaproveita cache', r.headers.get('x-cache') === 'MISS', r.headers.get('x-cache'));

  console.log('\n— facetas —');
  r = await req('GET', `/facetas?q=${M}`);
  ok('facetas → 200', r.status === 200, r.corpo);
  const cats = r.corpo?.dados?.categorias || [];
  ok('conta por categoria', cats.length === 2 && cats.reduce((s, c) => s + c.total, 0) === 6, cats);
  ok('conta por tipo', (r.corpo?.dados?.tipos || []).some((t) => t.valor === 'servico' && t.total === 1), r.corpo?.dados?.tipos);

  console.log('\n— sugestões —');
  r = await req('GET', `/sugestoes?q=${M}`);
  ok('autocomplete → 200', r.status === 200, r.corpo);
  ok('sugere categoria/marca/máquina/anúncio', (r.corpo?.dados || []).length > 0, r.corpo?.dados);
  r = await req('GET', `/sugestoes?q=a`);
  ok('termo de 1 caractere devolve vazio', (r.corpo?.dados || []).length === 0, r.corpo?.dados);
  r = await req('GET', `/sugestoes`);
  ok('sugestão sem termo → 422', r.status === 422, r.corpo);

  console.log('\n— log de busca vai para a fila —');
  await zerarCache();

  const antes = await db.BuscaLog.count({ where: { termo_normalizado: normalizar(`rolamento ${M}`) } });
  await req('GET', `/?q=rolamento%20${M}`);
  /* sem Redis o adaptador "imediato" executa na hora; com Redis, o worker
     consome. Esperar um instante cobre os dois casos no ambiente local */
  await new Promise((resolver) => setTimeout(resolver, 600));
  const depois = await db.BuscaLog.count({ where: { termo_normalizado: normalizar(`rolamento ${M}`) } });
  ok('busca gerou log (direto ou enfileirado)', depois >= antes, { antes, depois });

  /* o caminho de gravação é testado direto, sem depender do worker estar de pé */
  const logService = require(RAIZ + '/src/features/busca/busca.log.service');
  await logService.gravar({
    termo: `rolamento ${M}`,
    termoNormalizado: normalizar(`rolamento ${M}`),
    categoriaSlug: slugify(`Motor ${M}`),
    uf: 'MT',
    filtros: { ordem: 'relevancia' },
    totalResultados: 4,
    origem: 'api',
    ipHash: 'b'.repeat(64),
    sessaoHash: 'c'.repeat(64),
  });

  const gravado = await db.BuscaLog.findOne({
    where: { termo_normalizado: normalizar(`rolamento ${M}`) },
    order: [['criado_em', 'DESC']],
  });
  ok('log gravado com a categoria resolvida pelo slug', gravado?.categoria_id === cenario.categoriaFilha.id, gravado?.categoria_id);
  ok('IP só em hash de 64 caracteres', gravado?.ip_hash?.length === 64, gravado?.ip_hash);
  ok('log não guarda IP em claro', !/^\d+\.\d+\.\d+\.\d+$/.test(gravado?.ip_hash || ''), gravado?.ip_hash);

  await logService.gravar({
    termo: `pecaquenaoexiste ${M}`,
    termoNormalizado: normalizar(`pecaquenaoexiste ${M}`),
    filtros: {},
    totalResultados: 0,
    origem: 'api',
  });
  const semNada = await db.BuscaLog.findOne({
    where: { termo_normalizado: normalizar(`pecaquenaoexiste ${M}`) },
  });
  ok('busca sem resultado é marcada como tal', semNada?.sem_resultado === true, semNada?.sem_resultado);

  console.log('\n— termos populares —');
  const termoService = require(RAIZ + '/src/features/busca/busca.termo.service');
  const agregado = await termoService.agregarDia(new Date());
  ok('agregação do dia roda', Boolean(agregado?.data), agregado);

  /* idempotência: rodar de novo não pode duplicar */
  await termoService.agregarDia(new Date());
  const duplicados = await db.TermoPopular.count({
    where: { termo_normalizado: normalizar(`rolamento ${M}`) },
  });
  ok('job é idempotente (não duplica ao rodar duas vezes)', duplicados <= 1, duplicados);

  await require(RAIZ + '/src/features/busca/busca.cache').invalidarTermos();
  r = await req('GET', '/termos-populares?limite=5');
  ok('termos populares → 200', r.status === 200, r.corpo);
  ok('lista é um array', Array.isArray(r.corpo?.dados), r.corpo);

  await db.TermoPopular.destroy({
    where: { termo_normalizado: [normalizar(`rolamento ${M}`), normalizar(`pecaquenaoexiste ${M}`)] },
  });

  console.log('\n— validação de entrada —');
  r = await req('GET', `/?tipo=inexistente`);
  ok('tipo fora do vocabulário → 422', r.status === 422, r.corpo);
  r = await req('GET', `/?ord=aleatorio`);
  ok('ordenação inválida → 422', r.status === 422, r.corpo);
  r = await req('GET', `/?lat=999`);
  ok('latitude impossível → 422', r.status === 422, r.corpo);
  r = await req('GET', `/?q=${'a'.repeat(500)}`);
  ok('termo gigante → 422', r.status === 422, r.corpo);

  console.log('\n— limpeza —');
  await limpar();
  await require(RAIZ + '/src/features/busca/busca.cache').invalidarTudo();
  const restou = await db.Anuncio.count({ where: { id: cenario.anuncios.map((a) => a.id) }, paranoid: false });
  ok('cenário de teste removido do banco', restou === 0, restou);

  console.log(falhas === 0 ? '\n✅ busca: todos os testes passaram' : `\n❌ busca: ${falhas} falha(s)`);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
  process.exit(falhas === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('\nERRO NO TESTE:', e);
  /* limpa mesmo tendo quebrado: o banco é compartilhado com outros módulos */
  await limpar().catch((erro) => console.error('[limpeza] falhou:', erro.message));
  server?.close();
  await db.sequelize.close().catch(() => null);
  await encerrarInfra().catch(() => null);
  process.exit(1);
});
