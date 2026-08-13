'use strict';

/**
 * Denúncia de ponta a ponta, contra a API e o banco de verdade.
 *
 * Cobre o caminho feliz, a validação, o escopo negado e os dois vetores de
 * segurança específicos do módulo: idempotência por alvo (denunciar duas vezes
 * não vale por duas) e auto-denúncia bloqueada.
 *
 *   node testes/denuncia.test.js
 *
 * As rotas ainda não estão registradas em `src/routes/index.js` (arquivo que o
 * módulo não pode editar), então a suíte monta a mesma pilha do `app.js` —
 * contexto → rotas → handler de erro — e testa pela rede, como o front vê.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const { limparLimites, encerrarInfra } = require('./apoio');
const middlewares = require(RAIZ + '/src/middlewares');
const db = require(RAIZ + '/src/models');

function criarApp() {
  const app = express();
  app.use(express.json());
  app.use(middlewares.contexto);
  app.use('/api/v1/auth', require(RAIZ + '/src/features/auth/auth.routes'));
  app.use('/api/v1/denuncias', require(RAIZ + '/src/features/denuncia/denuncia.routes'));
  app.use(middlewares.erro);
  return app;
}

let server, base;
const req = async (metodo, caminho, corpo, token) => {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

const ok = (nome, cond, extra) =>
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));

/* identificador único por execução: o banco é compartilhado com outros agentes
   e um e-mail fixo faria a suíte passar só na primeira vez */
const MARCA = `d${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function criarConta(apelido, tipoPerfil = 'loja') {
  const email = `${apelido}.${MARCA}@agropecas.dev`;
  const r = await req('POST', '/auth/registrar', {
    nome: `Teste ${apelido}`,
    email,
    senha: 'SenhaForte123',
    tipoPerfil,
    nomeExibicao: `Teste ${apelido} ${MARCA}`,
    aceiteTermos: true,
    aceitePrivacidade: true,
  });
  if (r.status !== 201) throw new Error('falha ao criar conta ' + apelido + ': ' + JSON.stringify(r.corpo));
  return { id: r.corpo.dados.usuario.id, perfilId: r.corpo.dados.perfil.id, token: r.corpo.dados.tokens.acesso, email };
}

async function darPapel(usuarioId, chave) {
  const papel = await db.Papel.findOne({ where: { chave } });
  await db.UsuarioPapel.findOrCreate({
    where: { usuario_id: usuarioId, papel_id: papel.id },
    defaults: { usuario_id: usuarioId, papel_id: papel.id },
  });
}

const criarAnuncio = (dono, sufixo) =>
  db.Anuncio.create({
    /* `codigo` tem 12 caracteres e é único: o sufixo precisa sobreviver ao corte */
    codigo: `T${MARCA.slice(-9)}${sufixo}`,
    usuario_id: dono.id,
    perfil_id: dono.perfilId,
    tipo: 'peca',
    titulo: `Bomba hidráulica de teste ${MARCA}${sufixo}`,
    titulo_normalizado: `bomba hidraulica de teste ${MARCA}${sufixo}`,
    slug: `bomba-teste-${MARCA}-${sufixo}`,
    descricao: 'Peça criada pela suíte automatizada.',
    preco_centavos: 150000,
    status: 'publicado',
    moderacao_status: 'nao_revisado',
    publicado_em: new Date(),
  });

(async () => {
  await limparLimites();
  server = criarApp().listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api/v1';

  const dono = await criarConta('dono');
  const denunciante = await criarConta('denunciante');
  const outro = await criarConta('outro');
  const moderador = await criarConta('moderador');
  await darPapel(moderador.id, 'moderador');

  const anuncio = await criarAnuncio(dono, 'a');

  console.log('\n— criação —');
  let r = await req('POST', '/denuncias', { alvoTipo: 'anuncio', alvoId: anuncio.id, motivo: 'golpe', descricao: 'Pediu pagamento antecipado.' }, denunciante.token);
  ok('denuncia válida → 201', r.status === 201, r.corpo);
  const denunciaId = r.corpo?.dados?.id;
  ok('recibo não devolve o denunciante', !JSON.stringify(r.corpo).includes('denuncianteId'), r.corpo);

  r = await req('POST', '/denuncias', { alvoTipo: 'anuncio', alvoId: anuncio.id, motivo: 'spam' }, denunciante.token);
  ok('denúncia duplicada é idempotente → 200 com o mesmo registro', r.status === 200 && r.corpo?.dados?.id === denunciaId, r.corpo);
  const totalDoDenunciante = await db.Denuncia.count({ where: { denunciante_id: denunciante.id, alvo_id: anuncio.id } });
  ok('duplicada não criou segunda linha', totalDoDenunciante === 1, totalDoDenunciante);

  r = await req('POST', '/denuncias', { alvoTipo: 'anuncio', alvoId: anuncio.id, motivo: 'spam' }, dono.token);
  ok('auto-denúncia bloqueada → 403', r.status === 403 && r.corpo?.erro?.detalhe?.code === 'AUTO_DENUNCIA', r.corpo);

  r = await req('POST', '/denuncias', { alvoTipo: 'anuncio', alvoId: '00000000-0000-4000-8000-000000000000', motivo: 'spam' }, denunciante.token);
  ok('alvo inexistente → 404', r.status === 404, r.corpo);

  r = await req('POST', '/denuncias', { alvoTipo: 'nave', alvoId: anuncio.id }, denunciante.token);
  ok('entrada inválida → 422', r.status === 422, r.corpo);

  /* segunda denúncia no MESMO alvo, por outra pessoa: é o que faz a prioridade
     subir e o que a fila precisa enxergar */
  r = await req('POST', '/denuncias', { alvoTipo: 'anuncio', alvoId: anuncio.id, motivo: 'produto_falsificado' }, outro.token);
  ok('outra pessoa pode denunciar o mesmo alvo → 201', r.status === 201, r.corpo);

  console.log('\n— escopo RBAC —');
  r = await req('GET', '/denuncias', null, denunciante.token);
  ok('usuário comum não vê a fila → 403', r.status === 403, r.corpo);

  r = await req('GET', '/denuncias/agrupadas', null, denunciante.token);
  ok('usuário comum não vê o agrupamento → 403', r.status === 403, r.corpo);

  r = await req('GET', '/denuncias', null, moderador.token);
  ok('moderador vê a fila → 200', r.status === 200, r.corpo);
  const linha = (r.corpo?.dados || []).find((d) => d.alvoId === anuncio.id);
  ok('fila traz a contagem de denúncias no alvo (prioridade)', linha?.denunciasNoAlvo === 2, linha);
  ok('fila não expõe o denunciante', !JSON.stringify(r.corpo).includes('denuncianteId'), r.corpo?.dados?.[0]);

  r = await req('GET', '/denuncias/agrupadas', null, moderador.token);
  const grupo = (r.corpo?.dados || []).find((g) => g.alvoId === anuncio.id);
  ok('agrupamento por alvo vem do banco (GROUP BY)', r.status === 200 && grupo?.abertas === 2, grupo);

  console.log('\n— minhas denúncias —');
  r = await req('GET', '/denuncias/minhas', null, denunciante.token);
  ok('denunciante acompanha a própria denúncia', r.status === 200 && r.corpo.dados.some((d) => d.id === denunciaId), r.corpo);
  r = await req('GET', '/denuncias/minhas', null, outro.token);
  ok('não enxerga a denúncia de terceiro', !r.corpo.dados.some((d) => d.id === denunciaId), r.corpo);

  console.log('\n— resolução —');
  r = await req('PATCH', `/denuncias/${denunciaId}/resolver`, { status: 'procedente', acaoTomada: 'anuncio_ocultado' }, moderador.token);
  ok('resolver sem justificativa → 422', r.status === 422, r.corpo);

  r = await req('PATCH', `/denuncias/${denunciaId}/resolver`, { status: 'procedente', acaoTomada: 'anuncio_ocultado', resolucao: 'Confirmado golpe.' }, denunciante.token);
  ok('usuário comum não resolve → 403', r.status === 403, r.corpo);

  /* imparcialidade: moderador que abriu a denúncia não pode julgá-la */
  const propria = await req('POST', '/denuncias', { alvoTipo: 'anuncio', alvoId: (await criarAnuncio(dono, 'b')).id, motivo: 'spam' }, moderador.token);
  r = await req('PATCH', `/denuncias/${propria.corpo.dados.id}/resolver`, { status: 'procedente', acaoTomada: 'nenhuma', resolucao: 'Eu mesmo julgo.' }, moderador.token);
  ok('quem denunciou não julga a própria denúncia → 403', r.status === 403 && r.corpo?.erro?.detalhe?.code === 'CONFLITO_DE_INTERESSE', r.corpo);

  r = await req('PATCH', `/denuncias/${denunciaId}/resolver`, { status: 'procedente', acaoTomada: 'anuncio_ocultado', resolucao: 'Confirmado o relato de pagamento antecipado.' }, moderador.token);
  ok('moderador resolve → 200', r.status === 200 && r.corpo.dados.status === 'procedente', r.corpo);
  const irmas = await db.Denuncia.count({ where: { alvo_id: anuncio.id, status: 'procedente' } });
  ok('resolve em lote as denúncias do mesmo alvo', irmas === 2, irmas);

  r = await req('PATCH', `/denuncias/${denunciaId}/resolver`, { status: 'improcedente', acaoTomada: 'nenhuma', resolucao: 'Mudei de ideia.' }, moderador.token);
  ok('denúncia já resolvida → 409', r.status === 409, r.corpo);

  r = await req('GET', '/denuncias/minhas', null, denunciante.token);
  const minha = r.corpo.dados.find((d) => d.id === denunciaId);
  ok('denunciante vê o desfecho', minha?.status === 'procedente' && !!minha?.resolucao, minha);

  console.log('\n— auditoria —');
  const criacoes = await db.LogAuditoria.count({ where: { entidade: 'denuncias', acao: 'criar', entidade_id: denunciaId } });
  ok('abertura gerou linha em logs_auditoria', criacoes === 1, criacoes);
  const resolucoes = await db.LogAuditoria.count({ where: { entidade: 'denuncias', acao: 'editar', entidade_id: denunciaId } });
  ok('resolução gerou linha em logs_auditoria', resolucoes === 1, resolucoes);
  const log = await db.LogAuditoria.findOne({ where: { entidade: 'denuncias', entidade_id: denunciaId, acao: 'editar' } });
  ok('a trilha guarda o porquê', !!log?.motivo, log?.motivo);
  ok('IP só em hash', !log.ip_hash || log.ip_hash.length === 64, log.ip_hash);

  console.log('\n— LGPD —');
  const acessos = await db.LogAcessoDado.count({ where: { titular_id: dono.id, recurso: 'denuncia_ficha' } });
  r = await req('GET', `/denuncias/${denunciaId}`, null, moderador.token);
  const depois = await db.LogAcessoDado.count({ where: { titular_id: dono.id, recurso: 'denuncia_ficha' } });
  ok('abrir a ficha do denunciado grava logs_acesso_dado', depois === acessos + 1, { antes: acessos, depois });
  ok('moderador com poder de LGPD enxerga o denunciante na apuração', !!r.corpo?.dados?.denuncianteId, r.corpo);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
