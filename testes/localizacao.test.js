'use strict';

/**
 * Fluxo da feature `localizacao`, contra a API e o banco de verdade.
 *
 * Dois vetores importam mais que o caminho feliz e são o motivo desta suíte:
 *
 *  1. **Ofuscação de coordenada** — a promessa de privacidade feita ao produtor
 *     (Maturacao/05 §9.3). Se o endereço exato vazar por uma rota pública, o
 *     resto do módulo não importa.
 *  2. **Queda do provider externo** — o ViaCEP é público e gratuito, então vai
 *     cair. A API precisa devolver erro tratado e deixar o usuário digitar o
 *     endereço na mão; nunca 500, nunca cadastro travado.
 *
 * O provider é MOCKADO de propósito: teste que depende do ViaCEP no ar falha
 * por motivo alheio ao código e o time aprende a ignorá-lo.
 *
 *   node testes/localizacao.test.js
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const { limparLimites, encerrarInfra } = require('./apoio');
const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');
const geo = require(RAIZ + '/src/utils/geo');
const viacep = require(RAIZ + '/src/providers/viacep');
const geocode = require(RAIZ + '/src/providers/geocode');
const { indisponivel } = require(RAIZ + '/src/providers/http');

/**
 * A aplicação é montada aqui e não importada de `app.js` porque
 * `src/routes/index.js` é arquivo compartilhado e não pode ser editado por este
 * módulo (ver relatório). A pilha replica a de produção — contexto, rotas, 404
 * e o handler de erro único — para que o comportamento observado seja o mesmo.
 */
function montarApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(middlewares.contexto);
  app.use('/api/v1/auth', require(RAIZ + '/src/features/auth/auth.routes'));
  app.use('/api/v1/localizacao', require(RAIZ + '/src/features/localizacao/localizacao.routes'));
  app.use((req, res) =>
    res.status(404).json({ sucesso: false, erro: { codigo: 'ROTA_NAO_ENCONTRADA' } })
  );
  app.use(middlewares.erro);
  return app;
}

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

const ok = (nome, cond, extra) =>
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));

let falhas = 0;
const conferir = (nome, cond, extra) => {
  if (!cond) falhas += 1;
  ok(nome, cond, extra);
};

/* coordenada real usada como "propriedade do produtor": sede de Tangará da
   Serra deslocada alguns quilômetros, como seria uma fazenda */
const PONTO_REAL = { latitude: -14.5501234, longitude: -57.4012345 };

(async () => {
  await limparLimites();
  const app = montarApp();
  server = app.listen(0);
  const raizHttp = 'http://127.0.0.1:' + server.address().port + '/api/v1';
  base = raizHttp;

  // ─────────────────────────────────────────────────────────────
  console.log('\n— ofuscação de coordenada (função pura) —');

  const disfarcado = geo.ofuscarCoordenada(PONTO_REAL.latitude, PONTO_REAL.longitude, {
    raioMetros: 3000,
    semente: 'endereco-abc',
  });
  const desvio = geo.distanciaKm(PONTO_REAL, disfarcado);

  conferir('desloca o ponto', disfarcado.latitude !== PONTO_REAL.latitude, disfarcado);
  conferir('fica dentro do raio de 3 km', desvio !== null && desvio <= 3.2, desvio);
  conferir('não devolve o ponto real por acidente', desvio > 0, desvio);

  const repetido = geo.ofuscarCoordenada(PONTO_REAL.latitude, PONTO_REAL.longitude, {
    raioMetros: 3000,
    semente: 'endereco-abc',
  });
  conferir(
    'é determinístico (mil leituras não permitem tirar a média)',
    repetido.latitude === disfarcado.latitude && repetido.longitude === disfarcado.longitude,
    { disfarcado, repetido }
  );

  const outraSemente = geo.ofuscarCoordenada(PONTO_REAL.latitude, PONTO_REAL.longitude, {
    raioMetros: 3000,
    semente: 'endereco-xyz',
  });
  conferir(
    'sementes diferentes deslocam para lados diferentes',
    outraSemente.latitude !== disfarcado.latitude,
    { disfarcado, outraSemente }
  );

  conferir(
    'arredonda para 3 casas (não vaza o offset pela cauda decimal)',
    String(disfarcado.latitude).split('.')[1].length <= 3,
    disfarcado
  );

  conferir('coordenada 0,0 é recusada', geo.coordenadaValida(0, 0) === false);
  conferir('coordenada fora da faixa é recusada', geo.coordenadaValida(-100, -57) === false);

  const cuiabaSorriso = geo.distanciaKm(
    { latitude: -15.5989, longitude: -56.0949 },
    { latitude: -12.5453, longitude: -55.7211 }
  );
  conferir('Haversine bate com a realidade (Cuiabá→Sorriso ~342 km)', cuiabaSorriso > 320 && cuiabaSorriso < 360, cuiabaSorriso);

  // ─────────────────────────────────────────────────────────────
  console.log('\n— catálogo territorial —');

  let r = await req('GET', '/localizacao/estados');
  conferir('lista estados', r.status === 200 && r.corpo.dados.length === 27, r.corpo?.dados?.length);
  conferir('MT está lá com código IBGE', r.corpo.dados.some((e) => e.uf === 'MT' && e.codigoIbge === 51));

  r = await req('GET', '/localizacao/municipios?uf=MT&busca=tangara');
  conferir(
    'busca sem acento acha "Tangará da Serra"',
    r.status === 200 && r.corpo.dados.some((m) => m.nome === 'Tangará da Serra'),
    r.corpo
  );
  conferir('município traz coordenada da sede', r.corpo.dados[0]?.latitude !== null, r.corpo.dados[0]);
  conferir('listagem é paginada', typeof r.corpo.meta?.total === 'number', r.corpo.meta);

  // ─────────────────────────────────────────────────────────────
  console.log('\n— consulta de CEP (provider mockado) —');

  const cepFalso = '78455' + String(Math.floor(Math.random() * 900) + 100);
  const buscarOriginal = viacep.buscar;
  let chamadasAoProvider = 0;

  viacep.buscar = async () => {
    chamadasAoProvider += 1;
    return {
      encontrado: true,
      endereco: {
        cep: cepFalso,
        logradouro: 'Avenida Brasil',
        complemento: null,
        bairro: 'Centro',
        municipioNome: 'Tangará da Serra',
        uf: 'MT',
        codigoIbge: 5107903,
        ddd: '65',
        bruto: { cep: cepFalso, segredo: 'não pode aparecer na resposta' },
      },
    };
  };

  r = await req('GET', '/localizacao/cep/' + cepFalso);
  conferir('consulta CEP → 200', r.status === 200, r.corpo);
  conferir('resolve o município na nossa tabela', !!r.corpo.dados.endereco.municipioId, r.corpo.dados);
  conferir('herda a coordenada da sede quando o CEP não traz', r.corpo.dados.endereco.latitude !== null, r.corpo.dados);
  conferir('marca precisão aproximada para origem CEP', r.corpo.dados.endereco.precisao === 'aproximada', r.corpo.dados);
  conferir(
    'não vaza o retorno bruto do terceiro',
    !JSON.stringify(r.corpo).includes('não pode aparecer'),
    r.corpo
  );

  r = await req('GET', '/localizacao/cep/' + cepFalso);
  conferir('segunda consulta vem do cache (uma chamada só ao terceiro)', chamadasAoProvider === 1, chamadasAoProvider);

  r = await req('GET', '/localizacao/cep/1234');
  conferir('CEP malformado → 422 antes de tocar o terceiro', r.status === 422, r.corpo);

  // ─────────────────────────────────────────────────────────────
  console.log('\n— provider fora do ar —');

  /* o mock lança o MESMO erro que `providers/http` lança num timeout real —
     testar contra um erro inventado provaria só que o teste sabe inventar */
  viacep.buscar = async () => {
    throw indisponivel('consulta de CEP', 'timeout');
  };

  const cepQuebrado = '78400' + String(Math.floor(Math.random() * 900) + 100);
  r = await req('GET', '/localizacao/cep/' + cepQuebrado);
  conferir('ViaCEP fora → 503 tratado, não 500', r.status === 503, r.corpo);
  conferir('erro tem código estável para o front', r.corpo?.erro?.codigo === 'INTEGRACAO_INDISPONIVEL', r.corpo);
  conferir(
    'mensagem orienta o preenchimento manual',
    /manual/i.test(r.corpo?.erro?.mensagem || ''),
    r.corpo?.erro
  );

  const geocodeOriginal = geocode.reverso;
  geocode.reverso = async () => {
    throw indisponivel('localização por coordenada', 'timeout');
  };
  r = await req('GET', '/localizacao/reverso?latitude=-14.55&longitude=-57.40');
  conferir('geocode fora → 503 tratado', r.status === 503 && r.corpo?.erro?.codigo === 'INTEGRACAO_INDISPONIVEL', r.corpo);

  viacep.buscar = buscarOriginal;
  geocode.reverso = geocodeOriginal;

  // ─────────────────────────────────────────────────────────────
  console.log('\n— endereço vinculado ao perfil —');

  const marca = Date.now();
  const cadastrar = async (sufixo) => {
    const email = `loc${marca}${sufixo}@agropecas.dev`;
    const resposta = await req('POST', '/auth/registrar', {
      nome: 'produtor teste ' + sufixo,
      email,
      senha: 'SenhaForte123',
      tipoPerfil: 'produtor',
      nomeExibicao: `Fazenda Teste ${marca}${sufixo}`,
      aceiteTermos: true,
      aceitePrivacidade: true,
    });
    return {
      token: resposta.corpo?.dados?.tokens?.acesso,
      perfilId: resposta.corpo?.dados?.perfil?.id,
      usuarioId: resposta.corpo?.dados?.usuario?.id,
      status: resposta.status,
    };
  };

  const dono = await cadastrar('a');
  const intruso = await cadastrar('b');
  conferir('contas de apoio criadas', dono.status === 201 && intruso.status === 201, { dono, intruso });

  const corpoEndereco = {
    alvo: 'perfil',
    alvoId: dono.perfilId,
    origem: 'coordenada',
    latitude: PONTO_REAL.latitude,
    longitude: PONTO_REAL.longitude,
    logradouro: 'Estrada da Serra',
    numero: 'km 14',
    bairro: 'Zona Rural',
    cep: '78300000',
    municipioNome: 'Tangará da Serra',
    uf: 'MT',
  };

  r = await req('POST', '/localizacao/enderecos', corpoEndereco);
  conferir('gravar sem token → 401', r.status === 401, r.corpo);

  r = await req('POST', '/localizacao/enderecos', corpoEndereco, intruso.token);
  conferir('gravar endereço de perfil alheio → 403', r.status === 403, r.corpo);

  r = await req('POST', '/localizacao/enderecos', corpoEndereco, dono.token);
  conferir('dono grava → 201', r.status === 201, r.corpo);
  conferir('origem coordenada vira precisão exata', r.corpo?.dados?.precisao === 'exata', r.corpo?.dados);
  const enderecoId = r.corpo?.dados?.id;

  r = await req('POST', '/localizacao/enderecos', { ...corpoEndereco, origem: 'satelite' }, dono.token);
  conferir('origem fora do enum → 422', r.status === 422, r.corpo);

  r = await req(
    'POST',
    '/localizacao/enderecos',
    { ...corpoEndereco, latitude: 400 },
    dono.token
  );
  conferir('latitude fora da faixa → 422', r.status === 422, r.corpo);

  const enderecoNoBanco = await db.Endereco.findByPk(enderecoId);
  conferir('municipio_id resolvido na gravação', !!enderecoNoBanco.municipio_id, enderecoNoBanco?.municipio_nome);

  // ─────────────────────────────────────────────────────────────
  console.log('\n— privacidade na leitura (LGPD + regra da cliente) —');

  r = await req('GET', '/localizacao/enderecos/' + enderecoId);
  const publico = r.corpo?.dados;
  conferir('visitante lê o endereço → 200', r.status === 200, r.corpo);
  conferir('marcado como aproximado', publico?.aproximado === true, publico);
  conferir('não devolve logradouro', publico?.logradouro === null, publico);
  conferir('não devolve número', publico?.numero === null, publico);
  conferir('não devolve CEP (identifica a rua)', publico?.cep === null, publico);
  conferir('mantém município para o filtro de busca', !!publico?.municipio, publico);
  conferir(
    'coordenada devolvida NÃO é a real',
    publico?.latitude !== PONTO_REAL.latitude && publico?.longitude !== PONTO_REAL.longitude,
    publico
  );
  const desvioPublico = geo.distanciaKm(PONTO_REAL, publico);
  conferir('coordenada pública fica na região certa (≤ 3,2 km)', desvioPublico <= 3.2, desvioPublico);
  conferir('resposta traz o raio da aproximação para o selo do front', publico?.raioAproximacaoMetros === 3000, publico);

  const segundaLeitura = await req('GET', '/localizacao/enderecos/' + enderecoId);
  conferir(
    'leituras repetidas devolvem o MESMO ponto falso (sem média possível)',
    segundaLeitura.corpo.dados.latitude === publico.latitude,
    { primeira: publico.latitude, segunda: segundaLeitura.corpo.dados.latitude }
  );

  r = await req('GET', '/localizacao/enderecos/' + enderecoId, null, intruso.token);
  conferir('outro usuário logado também vê aproximado', r.corpo?.dados?.aproximado === true, r.corpo?.dados);

  r = await req('GET', '/localizacao/enderecos/' + enderecoId, null, dono.token);
  conferir('o dono vê o endereço exato', r.corpo?.dados?.aproximado === false, r.corpo?.dados);
  conferir('dono vê o logradouro que digitou', r.corpo?.dados?.logradouro === 'Estrada da Serra', r.corpo?.dados);
  conferir(
    'dono vê a coordenada real',
    Number(r.corpo?.dados?.latitude) === PONTO_REAL.latitude,
    r.corpo?.dados
  );

  // consentimento aberto pelo titular: agora o endereço exato é público
  await req(
    'POST',
    '/localizacao/enderecos',
    { ...corpoEndereco, exibirEnderecoExato: true },
    dono.token
  );
  r = await req('GET', '/localizacao/enderecos/' + enderecoId);
  conferir('com consentimento do titular, o público vê o exato', r.corpo?.dados?.aproximado === false, r.corpo?.dados);

  const consentimento = await db.Consentimento.findOne({
    where: { usuario_id: dono.usuarioId, tipo: 'exibir_endereco_exato' },
    order: [['criado_em', 'DESC']],
  });
  conferir('abrir o endereço grava consentimento LGPD demonstrável', !!consentimento && consentimento.aceito === true, consentimento?.tipo);

  // volta ao padrão para o teste de distância
  await req(
    'POST',
    '/localizacao/enderecos',
    { ...corpoEndereco, exibirEnderecoExato: false },
    dono.token
  );

  // ─────────────────────────────────────────────────────────────
  console.log('\n— distância —');

  const origem = { latitude: -15.5989, longitude: -56.0949 }; // Cuiabá

  r = await req('POST', '/localizacao/distancia', {
    ...origem,
    alvo: 'perfil',
    ids: [dono.perfilId],
  });
  const item = r.corpo?.dados?.[0];
  conferir('calcula distância para visitante → 200', r.status === 200 && !!item, r.corpo);
  conferir('distância marcada como aproximada', item?.aproximada === true, item);
  conferir(
    'distância sai em faixa de 5 km (barra trilateração)',
    item && item.distanciaKm % 5 === 0,
    item
  );

  r = await req('POST', '/localizacao/distancia', { ...origem, alvo: 'perfil', ids: [dono.perfilId] }, dono.token);
  conferir('o dono recebe a distância exata', r.corpo?.dados?.[0]?.aproximada === false, r.corpo?.dados);

  r = await req('POST', '/localizacao/distancia', {
    ...origem,
    alvo: 'perfil',
    ids: Array.from({ length: 80 }, () => dono.perfilId),
  });
  conferir('lote acima do teto → 422', r.status === 422, r.corpo);

  r = await req('POST', '/localizacao/distancia', { alvo: 'perfil', ids: [dono.perfilId] });
  conferir('sem coordenada de origem → 422', r.status === 422, r.corpo);

  console.log(falhas === 0 ? '\n✓ todos os testes passaram\n' : `\n✗ ${falhas} falha(s)\n`);

  server.close();
  await encerrarInfra();
  await db.sequelize.close();
  process.exit(falhas === 0 ? 0 : 1);
})().catch(async (erro) => {
  console.error('\nERRO NA SUÍTE:', erro);
  if (server) server.close();
  await encerrarInfra().catch(() => null);
  process.exit(1);
});
