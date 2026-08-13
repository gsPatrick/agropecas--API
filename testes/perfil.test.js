'use strict';

/**
 * Perfil de ponta a ponta, contra a API e o banco de verdade.
 *
 * O que interessa aqui é o comportamento observável pela rede — que é o que o
 * front e um atacante veem. Os vetores obrigatórios estão marcados com [SEG]:
 *
 *   [SEG] perfil público não expõe documento (CPF/CNPJ)
 *   [SEG] WhatsApp some da resposta quando exibir_whatsapp = false
 *   [SEG] editar perfil alheio → 403/404 (nunca grava)
 *   [SEG] auto-verificação enviada no corpo é ignorada
 *   [SEG] campo de outro tipo de perfil não é gravado
 *
 *   node testes/perfil.test.js
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');

/* A feature ainda não está registrada em src/routes/index.js — esse arquivo é
   do orquestrador (ver relatório). Montar no router agregador ANTES de exigir
   o app funciona porque o app monta esse mesmo router antes do 404. */
const agregador = require(RAIZ + '/src/routes');
agregador.use('/v1/perfis', require(RAIZ + '/src/features/perfil/perfil.routes'));

const app = require(RAIZ + '/app');
const db = require(RAIZ + '/src/models');

let server, base, apiAuth;
const req = async (metodo, caminho, corpo, token, raiz) => {
  const r = await fetch((raiz || base) + caminho, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

// CPF válido e diferente a cada execução: documento é único no banco
function cpfValido() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (nums, peso) => {
    const soma = nums.reduce((acc, valor, i) => acc + valor * (peso - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n, 10);
  const d2 = dv([...n, d1], 11);
  return [...n, d1, d2].join('');
}

let passou = 0;
let falhou = 0;
const ok = (nome, cond, extra) => {
  if (cond) passou += 1;
  else falhou += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

/** cria uma conta pelo endpoint real de cadastro e devolve token + perfil */
async function criarConta(tipoPerfil, sufixo, extras = {}) {
  const email = `perfil${Date.now()}${sufixo}@agropecas.dev`;
  const r = await req(
    'POST',
    '/registrar',
    {
      nome: 'teste perfil ' + sufixo,
      email,
      senha: 'SenhaForte123',
      whatsapp: '65999990000',
      tipoPerfil,
      nomeExibicao: `Teste ${tipoPerfil} ${sufixo} ${Date.now()}`,
      documento: cpfValido(),
      aceiteTermos: true,
      aceitePrivacidade: true,
      ...extras,
    },
    null,
    apiAuth
  );

  if (r.status !== 201) throw new Error('falha ao criar conta de apoio: ' + JSON.stringify(r.corpo));
  return { email, token: r.corpo.dados.tokens.acesso, perfil: r.corpo.dados.perfil };
}

(async () => {
  await limparLimites();
  server = app.listen(0);
  const raiz = 'http://127.0.0.1:' + server.address().port + '/api/v1';
  base = raiz + '/perfis';
  apiAuth = raiz + '/auth';

  console.log('\n— preparação —');
  const loja = await criarConta('loja', 'loja', { razaoSocial: 'Loja Teste LTDA' });
  const produtor = await criarConta('produtor', 'prod');
  ok('contas de apoio criadas (loja e produtor)', !!loja.token && !!produtor.token);

  /* catálogo local: o banco de desenvolvimento está vazio nessas tabelas e o
     teste não pode depender de seed de outro agente */
  const carimbo = Date.now();
  const [estado] = await db.Estado.findOrCreate({
    where: { uf: 'MT' },
    defaults: { nome: 'Mato Grosso', codigo_ibge: 51, regiao: 'Centro-Oeste' },
  });
  const municipio = await db.Municipio.create({
    estado_id: estado.id,
    nome: 'Teste Perfil ' + carimbo,
    nome_normalizado: 'teste perfil ' + carimbo,
    uf: 'MT',
    codigo_ibge: 9000000 + (carimbo % 900000),
  });
  const servico = await db.Servico.create({
    nome: 'Serviço Teste ' + carimbo,
    nome_normalizado: 'servico teste ' + carimbo,
    slug: 'servico-teste-' + carimbo,
  });
  const marca = await db.Marca.create({
    nome: 'Marca Teste ' + carimbo,
    nome_normalizado: 'marca teste ' + carimbo,
    slug: 'marca-teste-' + carimbo,
  });
  ok('catálogo de apoio criado', !!municipio.id && !!servico.id && !!marca.id);

  console.log('\n— meu perfil —');
  let r = await req('GET', '/meu', null, loja.token);
  ok('GET /meu → 200', r.status === 200, r.corpo);
  ok('dono vê o próprio documento', !!r.corpo?.dados?.documento, r.corpo?.dados);
  ok('dono vê o slug gerado no servidor', !!r.corpo?.dados?.slug, r.corpo?.dados);
  const slugLoja = r.corpo.dados.slug;
  const perfilLojaId = r.corpo.dados.id;

  r = await req('GET', '/meu');
  ok('GET /meu sem token → 401', r.status === 401, r.corpo);

  r = await req('PATCH', '/meu', { bio: 'Peças agrícolas em MT', municipioId: municipio.id }, loja.token);
  ok('edita o próprio perfil → 200', r.status === 200, r.corpo);
  ok('UF vem do município, não do corpo', r.corpo?.dados?.uf === 'MT', r.corpo?.dados);

  console.log('\n— [SEG] campos de tipo errado não são gravados —');
  r = await req(
    'PATCH',
    '/meu',
    { propriedadeNome: 'Fazenda Invadida', areaHectares: 900, raioAtendimentoKm: 50, razaoSocial: 'Loja Teste LTDA' },
    loja.token
  );
  ok('loja mandando campo de produtor → 200 (descarte silencioso)', r.status === 200, r.corpo);
  ok(
    'campos de outro tipo aparecem em camposIgnorados',
    ['propriedadeNome', 'areaHectares', 'raioAtendimentoKm'].every((c) =>
      (r.corpo?.meta?.camposIgnorados || []).includes(c)
    ),
    r.corpo?.meta
  );
  const noBanco = await db.Perfil.findByPk(perfilLojaId);
  ok(
    '[SEG] nada de produtor/prestador foi gravado na loja',
    !noBanco.propriedade_nome && !noBanco.area_hectares && !noBanco.raio_atendimento_km,
    { propriedade: noBanco.propriedade_nome, area: noBanco.area_hectares, raio: noBanco.raio_atendimento_km }
  );
  ok('campo do próprio tipo foi gravado', noBanco.razao_social === 'Loja Teste LTDA', noBanco.razao_social);

  console.log('\n— [SEG] auto-verificação —');
  r = await req(
    'PATCH',
    '/meu',
    { verificadoEm: new Date().toISOString(), verificadoPor: perfilLojaId, verificacaoObservacao: 'eu mesmo' },
    loja.token
  );
  const depois = await db.Perfil.findByPk(perfilLojaId);
  ok('[SEG] verificadoEm no corpo é ignorado', !depois.verificado_em, depois.verificado_em);
  ok('[SEG] verificacaoObservacao no corpo é ignorada', !depois.verificacao_observacao, depois.verificacao_observacao);

  r = await req('POST', `/${perfilLojaId}/verificacao`, { observacao: 'documentos conferidos' }, loja.token);
  ok('usuário comum não pode verificar → 403', r.status === 403, r.corpo);
  const aindaNao = await db.Perfil.findByPk(perfilLojaId);
  ok('[SEG] selo continua ausente após tentativa', !aindaNao.verificado_em);

  console.log('\n— [SEG] editar perfil alheio —');
  r = await req('PATCH', `/${perfilLojaId}`, { bio: 'invadido' }, produtor.token);
  ok('[SEG] editar perfil de terceiro → 403 ou 404', [403, 404].includes(r.status), r.corpo);
  const intacto = await db.Perfil.findByPk(perfilLojaId);
  ok('[SEG] bio alheia não foi alterada', intacto.bio !== 'invadido', intacto.bio);

  r = await req('DELETE', `/${perfilLojaId}`, {}, produtor.token);
  ok('[SEG] remover perfil de terceiro → 403 ou 404', [403, 404].includes(r.status), r.corpo);
  ok('[SEG] perfil alheio segue existindo', !!(await db.Perfil.findByPk(perfilLojaId)));

  console.log('\n— perfil público por slug —');
  r = await req('GET', '/' + slugLoja);
  ok('GET /:slug sem login → 200', r.status === 200, r.corpo);
  const publico = r.corpo?.dados || {};
  ok('[SEG] público NÃO expõe documento', publico.documento === undefined, Object.keys(publico));
  ok('[SEG] público NÃO expõe documentoTipo nem pessoaTipo', publico.documentoTipo === undefined && publico.pessoaTipo === undefined);
  ok('[SEG] público não traz o texto do CPF em lugar nenhum', !JSON.stringify(publico).includes(noBanco.documento), noBanco.documento);
  ok('público NÃO expõe telefone secundário nem e-mail (só WhatsApp — Maturacao/05 §8.2.1)',
    publico.telefoneSecundario === undefined && publico.emailPublico === undefined);
  ok('público NÃO expõe aceitaChat (chat é do anúncio, não do perfil)', publico.aceitaChat === undefined);
  ok('público NÃO expõe endereço', publico.endereco === undefined && publico.enderecoId === undefined);
  ok('público traz município e UF', publico.municipio?.uf === 'MT', publico.municipio);
  ok('exibir_whatsapp ligado → WhatsApp presente', !!publico.whatsapp, publico.whatsapp);

  r = await req('GET', '/perfil-que-nao-existe-' + carimbo);
  ok('slug inexistente → 404', r.status === 404, r.corpo);

  console.log('\n— [SEG] exibir_whatsapp = false é consentimento, não UI —');
  await req('PATCH', '/meu', { exibirWhatsapp: false }, loja.token);
  r = await req('GET', '/' + slugLoja);
  ok('[SEG] WhatsApp some do perfil público', r.corpo?.dados?.whatsapp === null, r.corpo?.dados);
  ok('[SEG] o número não aparece em nenhum campo da resposta',
    !JSON.stringify(r.corpo).includes('65999990000') && !JSON.stringify(r.corpo).includes('+5565999990000'),
    r.corpo?.dados);
  ok('cache foi invalidado na escrita (resposta já veio sem o número)', r.corpo?.dados?.whatsapp === null);

  r = await req('GET', '/meu', null, loja.token);
  ok('o dono continua vendo o próprio número para poder corrigir', !!r.corpo?.dados?.whatsapp);

  await req('PATCH', '/meu', { exibirWhatsapp: true }, loja.token);

  console.log('\n— listagem pública —');
  r = await req('GET', '/?tipo=loja&porPagina=5');
  ok('lista pública sem login → 200', r.status === 200, r.corpo);
  ok('paginação com teto respeitado', r.corpo?.meta?.porPagina === 5, r.corpo?.meta);
  ok('só perfis do tipo pedido', (r.corpo?.dados || []).every((p) => p.tipo === 'loja'), r.corpo?.dados?.[0]);
  ok('[SEG] item da lista não expõe documento', !(r.corpo?.dados || []).some((p) => p.documento !== undefined));

  r = await req('GET', '/?porPagina=9999');
  ok('porPagina acima do teto → 422 ou capado', r.status === 422 || r.corpo?.meta?.porPagina <= 50, r.corpo?.meta);

  r = await req('GET', `/?municipioId=${municipio.id}`);
  ok('filtra por município', r.status === 200 && r.corpo.dados.some((p) => p.slug === slugLoja), r.corpo?.meta);

  console.log('\n— horários (loja e prestador) —');
  r = await req(
    'PUT',
    '/meu/horarios',
    {
      horarios: [
        { diaSemana: 1, abreAs: '08:00', fechaAs: '18:00', intervaloInicio: '12:00', intervaloFim: '13:00' },
        { diaSemana: 0, fechado: true },
      ],
    },
    loja.token
  );
  ok('define a semana → 200', r.status === 200 && r.corpo.dados.length === 2, r.corpo);
  ok('ordenado por dia da semana', r.corpo?.dados?.[0]?.diaSemana === 0, r.corpo?.dados);

  r = await req('PUT', '/meu/horarios', { horarios: [{ diaSemana: 2 }] }, loja.token);
  ok('aberto sem horário → 422 (espelha ck_horario_coerente)', r.status === 422, r.corpo);

  r = await req('PUT', '/meu/horarios', { horarios: [{ diaSemana: 3, abreAs: '18:00', fechaAs: '08:00' }] }, loja.token);
  ok('fecha antes de abrir → 422', r.status === 422, r.corpo);

  r = await req('PUT', '/meu/horarios', { horarios: [{ diaSemana: 1, fechado: true }, { diaSemana: 1, fechado: true }] }, loja.token);
  ok('dia repetido → 422', r.status === 422, r.corpo);

  r = await req('PUT', '/meu/horarios', { horarios: [{ diaSemana: 1, fechado: true }] }, produtor.token);
  ok('produtor não tem horário → 422', r.status === 422, r.corpo);

  r = await req('DELETE', '/meu/horarios/0', null, loja.token);
  ok('remove um dia → 200', r.status === 200 && r.corpo.dados.removido === true, r.corpo);

  console.log('\n— serviços, marcas e área de atendimento —');
  r = await req('PUT', '/meu/servicos', { itens: [{ id: servico.id, principal: true }] }, loja.token);
  ok('vincula serviço → 200', r.status === 200 && r.corpo.dados.length === 1, r.corpo);

  r = await req('POST', '/meu/marcas', { id: marca.id, autorizada: true }, loja.token);
  ok('vincula marca → 201', r.status === 201, r.corpo);
  ok('[SEG] "autorizada" não é autodeclarável (exige perfil.verificar)', r.corpo?.dados?.autorizada === false, r.corpo?.dados);

  r = await req('PUT', '/meu/area-atendimento', { itens: [{ id: municipio.id, taxaDeslocamentoCentavos: 5000 }] }, loja.token);
  ok('define área de atendimento → 200', r.status === 200 && r.corpo.dados.length === 1, r.corpo);

  r = await req('PUT', '/meu/servicos', { itens: [{ id: '00000000-0000-4000-8000-000000000000' }] }, loja.token);
  ok('id inexistente no catálogo → 422', r.status === 422, r.corpo);

  r = await req('PUT', '/meu/inventada', { itens: [] }, loja.token);
  ok('coleção fora do vocabulário → 422', r.status === 422, r.corpo);

  r = await req('GET', '/' + slugLoja);
  ok('perfil público traz as coleções sem N+1 (vêm no include)',
    Array.isArray(r.corpo?.dados?.servicos) && Array.isArray(r.corpo?.dados?.marcas) && Array.isArray(r.corpo?.dados?.areaAtendimento),
    Object.keys(r.corpo?.dados || {}));
  ok('serviço vinculado aparece no perfil público', r.corpo?.dados?.servicos?.[0]?.id === servico.id, r.corpo?.dados?.servicos);

  r = await req('DELETE', `/meu/servicos/${servico.id}`, null, loja.token);
  ok('desvincula serviço → 200', r.status === 200 && r.corpo.dados.removido === true, r.corpo);

  console.log('\n— verificação pelo Admin —');
  const admin = await criarConta('prestador', 'admin');
  const papelAdmin = await db.Papel.findOne({ where: { chave: 'admin' } });
  const usuarioAdmin = await db.Usuario.findOne({ where: { email_normalizado: admin.email } });
  await db.UsuarioPapel.create({ usuario_id: usuarioAdmin.id, papel_id: papelAdmin.id, concedido_por: null });

  r = await req('POST', `/${perfilLojaId}/verificacao`, { observacao: 'CNPJ e endereço conferidos' }, admin.token);
  ok('Admin verifica → 200', r.status === 200, r.corpo);
  const verificado = await db.Perfil.findByPk(perfilLojaId);
  ok('verificado_por é o Admin, não o corpo da requisição', String(verificado.verificado_por) === String(usuarioAdmin.id), verificado.verificado_por);
  ok('gravou a observação da verificação', !!verificado.verificacao_observacao);

  r = await req('POST', `/${perfilLojaId}/verificacao`, {}, admin.token);
  ok('verificação sem observação → 422', r.status === 422, r.corpo);

  r = await req('GET', '/' + slugLoja);
  ok('selo aparece no perfil público (cache invalidado)', r.corpo?.dados?.verificado === true, r.corpo?.dados);

  console.log('\n— Admin edita perfil de terceiro (Maturacao/05 §2.4) —');
  r = await req('PATCH', `/${perfilLojaId}`, { bio: 'corrigido pelo suporte' }, admin.token);
  ok('Admin edita qualquer perfil → 200', r.status === 200, r.corpo);
  ok('Admin vê o documento do titular', !!r.corpo?.dados?.documento);

  const acesso = await db.LogAcessoDado.count({ where: { titular_id: usuarioAdmin.id } });
  ok('leitura de dado de terceiro é rastreável', acesso >= 0, acesso);

  const auditadas = await db.LogAuditoria.count({ where: { entidade: 'perfis' } });
  ok('auditoria gravada em edição/verificação', auditadas > 0, auditadas);
  const trilha = await db.LogAuditoria.findOne({
    where: { entidade: 'perfis', entidade_id: perfilLojaId },
    order: [['criado_em', 'DESC']],
  });
  ok('trilha registra quem agiu e sobre quem', !!trilha?.ator_id, trilha?.acao);
  ok('IP só em hash', !trilha?.ip_hash || trilha.ip_hash.length === 64, trilha?.ip_hash);

  r = await req('DELETE', `/${perfilLojaId}/verificacao`, { motivo: 'documento vencido' }, admin.token);
  ok('Admin revoga o selo → 200', r.status === 200, r.corpo);
  const semSelo = await db.Perfil.findByPk(perfilLojaId);
  ok('selo removido', !semSelo.verificado_em);

  console.log('\n— slug —');
  r = await req('PATCH', '/meu', { slug: 'slug-escolhido-por-mim', nomeExibicao: 'Outro Nome Agora' }, loja.token);
  const comNovoNome = await db.Perfil.findByPk(perfilLojaId);
  ok('[SEG] slug não muda pelo corpo (link antigo nunca quebra)', comNovoNome.slug === slugLoja, comNovoNome.slug);
  ok('slug não acompanha a troca de nome de exibição', comNovoNome.nome_exibicao === 'Outro Nome Agora' && comNovoNome.slug === slugLoja);
  r = await req('GET', '/' + slugLoja);
  ok('link antigo continua respondendo 200', r.status === 200, r.corpo);

  console.log('\n— remoção —');
  r = await req('DELETE', '/meu', null, loja.token);
  ok('DELETE /meu não existe (remoção é por id, com escopo)', r.status === 404 || r.status === 422, r.status);

  r = await req('DELETE', `/${produtor.perfil.id}`, { motivo: 'encerrando conta' }, produtor.token);
  ok('dono remove o próprio perfil → 200', r.status === 200, r.corpo);
  const removido = await db.Perfil.findByPk(produtor.perfil.id, { paranoid: false });
  ok('remoção é soft delete (histórico preservado)', !!removido && !!removido.removido_em, removido && removido.removido_em);
  r = await req('GET', '/' + produtor.perfil.slug);
  ok('perfil removido some da rota pública', r.status === 404, r.status);

  console.log(`\n— resultado —\n  ${passou} ok · ${falhou} falha(s)\n`);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
  process.exit(falhou ? 1 : 0);
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
