'use strict';

/**
 * Módulo de conta de ponta a ponta, contra a API e o banco de verdade.
 * O que interessa é o comportamento observável pela rede — o que o front e um
 * atacante veem.
 *
 *   node testes/usuario.test.js
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');

/* a feature ainda não está registrada em `src/routes/index.js` (arquivo do
   orquestrador, que este módulo não pode editar). Montar aqui, no MESMO
   Router que o app usa, deixa o teste rodar de verdade sem tocar no arquivo */
const rotas = require(RAIZ + '/src/routes');
rotas.use('/v1/usuarios', require(RAIZ + '/src/features/usuario/usuario.routes'));

const app = require(RAIZ + '/app');
const db = require(RAIZ + '/src/models');
const { hashToken } = require(RAIZ + '/src/utils/hash');

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

/* e-mail único por execução: a base é compartilhada com outros agentes e não
   pode ser derrubada entre rodadas */
const emailDe = (rotulo) => `usr-${rotulo}-${Date.now()}${Math.floor(Math.random() * 1000)}@agropecas.dev`;

const registrar = async (rotulo, tipo = 'produtor') => {
  const email = emailDe(rotulo);
  const r = await req('POST', '/auth/registrar', {
    nome: `Teste ${rotulo}`,
    email,
    senha: 'SenhaForte123',
    tipoPerfil: tipo,
    aceiteTermos: true,
    aceitePrivacidade: true,
  });
  if (r.status !== 201) throw new Error('falha ao registrar ' + rotulo + ': ' + JSON.stringify(r.corpo));
  return { email, id: r.corpo.dados.usuario.id, token: r.corpo.dados.tokens.acesso };
};

(async () => {
  await limparLimites();
  server = app.listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api/v1';

  const alice = await registrar('alice');
  const bruno = await registrar('bruno', 'loja');
  const chefe = await registrar('chefe');

  /* o admin é montado no banco de propósito: conceder papel pela API exigiria
     um admin anterior, e o teste não pode depender do seed local */
  const papelAdmin = await db.Papel.findOne({ where: { chave: 'admin' } });
  const papelModerador = await db.Papel.findOne({ where: { chave: 'moderador' } });
  await db.UsuarioPapel.create({ usuario_id: chefe.id, papel_id: papelAdmin.id });

  console.log('\n— meus dados —');
  let r = await req('GET', '/usuarios/eu', null, alice.token);
  ok('GET /eu → 200 com a própria conta', r.status === 200 && r.corpo.dados.id === alice.id, r.corpo);
  ok('não vaza observacoes_internas nem senha', !JSON.stringify(r.corpo).match(/senha_hash|observacoes_internas/));

  r = await req('PATCH', '/usuarios/eu', { nome: 'alice maria souza', fusoHorario: 'America/Sao_Paulo' }, alice.token);
  ok('edita o próprio perfil → 200', r.status === 200 && r.corpo.dados.nome === 'Alice Maria Souza', r.corpo);
  const depoisEdicao = await db.Usuario.findByPk(alice.id);
  ok('gravou no banco', depoisEdicao.fuso_horario === 'America/Sao_Paulo', depoisEdicao.fuso_horario);

  r = await req('PATCH', '/usuarios/eu', { nome: 'x' }, alice.token);
  ok('nome curto → 422', r.status === 422, r.corpo);

  console.log('\n— escopo —');
  r = await req('PATCH', '/usuarios/' + bruno.id, { nome: 'Invadido' }, alice.token);
  ok('editar conta de terceiro → 403', r.status === 403, r.corpo);
  const brunoIntacto = await db.Usuario.findByPk(bruno.id);
  ok('e o registro do terceiro não mudou', brunoIntacto.nome !== 'Invadido', brunoIntacto.nome);

  r = await req('GET', '/usuarios', null, alice.token);
  ok('listar sem permissão → 403', r.status === 403, r.corpo);

  r = await req('GET', '/usuarios/' + bruno.id, null, alice.token);
  ok('ver ficha alheia → 404 (indistinguível de inexistente)', r.status === 404, r.corpo);
  r = await req('GET', '/usuarios/00000000-0000-4000-8000-000000000000', null, alice.token);
  ok('id inexistente → mesmo 404', r.status === 404, r.corpo);

  r = await req('GET', '/usuarios?porPagina=5000', null, chefe.token);
  ok('admin lista com teto de paginação', r.status === 200 && r.corpo.meta.porPagina <= 100, r.corpo?.meta);
  ok('listagem não traz colunas internas', !JSON.stringify(r.corpo).includes('observacoes_internas'));
  r = await req('GET', '/usuarios?busca=' + encodeURIComponent(bruno.email), null, chefe.token);
  ok('busca por e-mail encontra', r.status === 200 && r.corpo.dados.some((u) => u.id === bruno.id), r.corpo?.meta);

  console.log('\n— LGPD: leitura de dado de terceiro —');
  const antesLog = await db.LogAcessoDado.count({ where: { titular_id: bruno.id } });
  r = await req('GET', '/usuarios/' + bruno.id, null, chefe.token);
  ok('admin abre a ficha → 200', r.status === 200, r.corpo);
  const depoisLog = await db.LogAcessoDado.count({ where: { titular_id: bruno.id } });
  ok('leitura de terceiro gera logs_acesso_dado', depoisLog > antesLog, { antesLog, depoisLog });
  const proprioLog = await db.LogAcessoDado.count({ where: { ator_id: alice.id, titular_id: alice.id } });
  ok('titular lendo a si mesmo não polui o log', proprioLog === 0, proprioLog);

  console.log('\n— suspensão —');
  r = await req('POST', '/usuarios/' + bruno.id + '/suspender', { motivo: 'anúncio irregular reincidente' }, chefe.token);
  ok('suspender sem prazo → 422', r.status === 422, r.corpo);

  const ate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  r = await req('POST', '/usuarios/' + bruno.id + '/suspender', { motivo: 'anúncio irregular reincidente', ate }, chefe.token);
  ok('suspender com motivo e prazo → 200', r.status === 200, r.corpo);

  const sessoesVivas = await db.Sessao.count({ where: { usuario_id: bruno.id, revogada_em: null } });
  ok('suspensão derruba as sessões', sessoesVivas === 0, sessoesVivas);
  r = await req('GET', '/usuarios/eu', null, bruno.token);
  ok('token do suspenso deixa de valer', r.status === 401 || r.status === 423, r.status);
  const auditSusp = await db.LogAuditoria.count({ where: { acao: 'suspender', entidade_id: bruno.id } });
  ok('suspensão gravada em logs_auditoria', auditSusp > 0, auditSusp);

  r = await req('POST', '/usuarios/' + bruno.id + '/restaurar', { motivo: 'recurso aceito' }, chefe.token);
  ok('restaurar → 200', r.status === 200, r.corpo);
  const brunoRestaurado = await db.Usuario.findByPk(bruno.id);
  ok('volta para pendente (e-mail não confirmado)', brunoRestaurado.status === 'pendente', brunoRestaurado.status);

  console.log('\n— escalada de privilégio —');
  r = await req('POST', '/usuarios/' + chefe.id + '/banir', { motivo: 'testando o limite do poder' }, chefe.token);
  ok('auto-banimento → 400', r.status === 400 && r.corpo.erro.codigo === 'REQUISICAO_INVALIDA', r.corpo);
  const chefeVivo = await db.Usuario.findByPk(chefe.id);
  ok('a conta do admin segue ativa', chefeVivo.status !== 'banido', chefeVivo.status);

  r = await req('POST', '/usuarios/' + chefe.id + '/papeis', { papel: 'admin' }, chefe.token);
  ok('dar papel a si mesmo → 403', r.status === 403, r.corpo);
  r = await req('DELETE', '/usuarios/' + chefe.id + '/papeis/admin', null, chefe.token);
  ok('remover o próprio admin → 403', r.status === 403, r.corpo);
  const aindaAdmin = await db.UsuarioPapel.count({ where: { usuario_id: chefe.id, papel_id: papelAdmin.id } });
  ok('o vínculo de admin continua', aindaAdmin === 1, aindaAdmin);

  r = await req('POST', '/usuarios/' + bruno.id + '/papeis', { papel: 'moderador', motivo: 'entrou no time' }, chefe.token);
  ok('admin concede papel a terceiro → 200', r.status === 200 && r.corpo.dados.some((p) => p.chave === 'moderador'), r.corpo);
  r = await req('POST', '/usuarios/' + alice.id + '/papeis', { papel: 'moderador' }, alice.token);
  ok('usuário comum não concede papel → 403', r.status === 403, r.corpo);
  r = await req('DELETE', '/usuarios/' + bruno.id + '/papeis/moderador', null, chefe.token);
  ok('admin remove papel de terceiro → 200', r.status === 200, r.corpo);
  ok('vínculo removido', (await db.UsuarioPapel.count({ where: { usuario_id: bruno.id, papel_id: papelModerador.id } })) === 0);

  console.log('\n— troca de e-mail —');
  const novoEmail = emailDe('alice-novo');
  r = await req('POST', '/usuarios/eu/email', { email: novoEmail, senhaAtual: 'errada' }, alice.token);
  ok('senha errada → 422', r.status === 422, r.corpo);
  r = await req('POST', '/usuarios/eu/email', { email: bruno.email, senhaAtual: 'SenhaForte123' }, alice.token);
  ok('e-mail já usado → 409', r.status === 409, r.corpo);

  r = await req('POST', '/usuarios/eu/email', { email: novoEmail, senhaAtual: 'SenhaForte123' }, alice.token);
  ok('solicita troca → 200 com destino mascarado', r.status === 200 && r.corpo.dados.destino.includes('*'), r.corpo);
  const aliceMeio = await db.Usuario.findByPk(alice.id);
  ok('o e-mail NÃO muda antes da confirmação', aliceMeio.email === alice.email, aliceMeio.email);

  const pendente = await db.TokenVerificacao.findOne({
    where: { usuario_id: alice.id, tipo: 'verificacao_email', usado_em: null, invalidado_em: null },
    order: [['criado_em', 'DESC']],
  });
  ok('token guarda o novo endereço em `destino`', pendente?.destino === novoEmail, pendente?.destino);
  ok('código guardado em hash', pendente && pendente.codigo_hash.length === 64);

  r = await req('POST', '/usuarios/eu/email/confirmar', { codigo: '000000' }, alice.token);
  ok('código errado → 400 genérico', r.status === 400, r.corpo);

  /* o código em claro só existe no e-mail enviado; o teste fixa um conhecido
     para poder exercitar a confirmação */
  await pendente.update({ codigo_hash: hashToken('123456'), tentativas: 0 });
  r = await req('POST', '/usuarios/eu/email/confirmar', { codigo: '123456' }, alice.token);
  ok('confirma → 200', r.status === 200, r.corpo);
  const aliceNova = await db.Usuario.findByPk(alice.id);
  ok('e-mail trocado e verificado', aliceNova.email === novoEmail && !!aliceNova.email_verificado_em, aliceNova.email);

  console.log('\n— exclusão de conta (LGPD) —');
  r = await req('DELETE', '/usuarios/eu', { senhaAtual: 'errada' }, alice.token);
  ok('exclusão sem senha correta → 422', r.status === 422, r.corpo);

  r = await req('DELETE', '/usuarios/eu', { senhaAtual: 'SenhaForte123', motivo: 'não uso mais' }, alice.token);
  ok('exclui → 200', r.status === 200 && r.corpo.dados.anonimizado, r.corpo);

  const removida = await db.Usuario.findByPk(alice.id, { paranoid: false });
  ok('registro NÃO foi apagado', !!removida, removida);
  ok('soft delete aplicado', !!removida?.removido_em);
  ok('dados pessoais anonimizados', removida.nome === 'Usuário removido' && removida.email !== novoEmail && !removida.telefone, {
    nome: removida.nome,
    email: removida.email,
  });
  ok('senha zerada', !removida.senha_hash);
  ok('retenção agendada (LGPD_RETENCAO_DIAS)', !!removida.excluir_definitivamente_em && !!removida.anonimizado_em, removida.excluir_definitivamente_em);
  ok('status removido', removida.status === 'removido', removida.status);
  const sessoesAlice = await db.Sessao.count({ where: { usuario_id: alice.id, revogada_em: null } });
  ok('sessões encerradas na exclusão', sessoesAlice === 0, sessoesAlice);
  const auditExclusao = await db.LogAuditoria.findOne({ where: { acao: 'remover', entidade_id: alice.id } });
  ok('exclusão auditada', !!auditExclusao);
  ok('a trilha não reintroduz o dado pessoal', !JSON.stringify(auditExclusao?.antes || {}).includes('@'), auditExclusao?.antes);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
