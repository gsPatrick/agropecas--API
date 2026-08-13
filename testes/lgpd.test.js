'use strict';

/**
 * Módulo de LGPD, de ponta a ponta, contra a API e o banco de verdade.
 *
 *   node testes/lgpd.test.js
 *
 * As rotas de `lgpd` ainda não estão em `src/routes/index.js` (o arquivo é do
 * orquestrador). O teste monta a mesma pilha de middlewares do `app.js` e
 * pendura os routers — o que roda aqui é exatamente o que rodará em produção.
 */

process.env.NODE_ENV = 'development';
const RAIZ = require('path').resolve(__dirname, '..');
const express = require('express');
const cookieParser = require('cookie-parser');
const { limparLimites, encerrarInfra } = require('./apoio');

const db = require(RAIZ + '/src/models');
const middlewares = require(RAIZ + '/src/middlewares');
const tokenService = require(RAIZ + '/src/features/auth/auth.token.service');
const anonimizacao = require(RAIZ + '/src/features/lgpd/lgpd.anonimizacao.service');
const pacote = require(RAIZ + '/src/features/lgpd/lgpd.pacote.service');
const link = require(RAIZ + '/src/features/lgpd/lgpd.link.service');

function montarApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use(middlewares.contexto);
  app.use('/api/v1/auth', require(RAIZ + '/src/features/auth/auth.routes'));
  app.use('/api/v1/lgpd', require(RAIZ + '/src/features/lgpd/lgpd.routes'));
  app.use((req, res) => res.status(404).json({ sucesso: false, erro: { codigo: 'ROTA_NAO_ENCONTRADA' } }));
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
  const texto = await r.text();
  let corpoResposta = null;
  try {
    corpoResposta = JSON.parse(texto);
  } catch (e) {
    corpoResposta = texto;
  }
  return { status: r.status, corpo: corpoResposta };
};

let falhas = 0;
const ok = (nome, cond, extra) => {
  if (!cond) falhas += 1;
  console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));
};

const marca = Date.now();

(async () => {
  await limparLimites();
  const app = montarApp();
  server = app.listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api/v1';

  const cadastrar = async (sufixo) => {
    const email = `lgpd-${sufixo}-${marca}@agropecas.dev`;
    const r = await req('POST', '/auth/registrar', {
      nome: 'Titular ' + sufixo,
      email,
      senha: 'SenhaForte123',
      tipoPerfil: 'produtor',
      nomeExibicao: `Fazenda ${sufixo} ${marca}`,
      aceiteTermos: true,
      aceitePrivacidade: true,
    });
    if (r.status !== 201) throw new Error('cadastro falhou: ' + JSON.stringify(r.corpo));
    return { email, ...r.corpo.dados };
  };

  const titular = await cadastrar('titular');
  const outro = await cadastrar('outro');
  const dpo = await cadastrar('dpo');

  const usuarioTitular = await db.Usuario.findOne({ where: { email_normalizado: titular.email } });
  const usuarioOutro = await db.Usuario.findOne({ where: { email_normalizado: outro.email } });
  const usuarioDpo = await db.Usuario.findOne({ where: { email_normalizado: dpo.email } });

  /* o encarregado é modelado como Admin: `lgpd.responder_solicitacao` só existe
     com escopo `todas`, e hoje só o papel admin o recebe */
  const papelAdmin = await db.Papel.findOne({ where: { chave: 'admin' } });
  await db.UsuarioPapel.create({ usuario_id: usuarioDpo.id, papel_id: papelAdmin.id });
  const tokenDpo = (await req('POST', '/auth/entrar', { email: dpo.email, senha: 'SenhaForte123' }))
    .corpo.dados.tokens.acesso;

  const tokenTitular = titular.tokens.acesso;
  const tokenOutro = outro.tokens.acesso;

  // ─── documentos legais e consentimento desatualizado ──────────
  console.log('\n— documentos legais —');

  let r = await req('POST', '/lgpd/documentos', {
    tipo: 'termos_de_uso',
    versao: `9.${marca % 1000}`,
    titulo: 'Termos de Uso AgroPeças MT',
    conteudo: 'Texto integral dos termos de uso para fins de teste automatizado. '.repeat(3),
    resumoMudancas: 'Versão de teste.',
    exigeNovoAceite: true,
  }, tokenDpo);
  ok('encarregado publica nova versão → 201', r.status === 201, r.corpo);
  const versaoPublicada = r.corpo?.dados?.versao;
  ok('versão traz hash do conteúdo (prova de integridade)', (r.corpo?.dados?.hashConteudo || '').length === 64, r.corpo?.dados);

  r = await req('POST', '/lgpd/documentos', {
    tipo: 'termos_de_uso',
    versao: versaoPublicada,
    titulo: 'Repetida',
    conteudo: 'Texto integral repetido para conferir a recusa de versão duplicada. '.repeat(2),
  }, tokenDpo);
  ok('mesma versão duas vezes → 409', r.status === 409, r.corpo);

  r = await req('POST', '/lgpd/documentos', {
    tipo: 'termos_de_uso',
    versao: `8.${marca % 1000}`,
    titulo: 'Sem permissão',
    conteudo: 'Texto integral qualquer para conferir a recusa por permissão. '.repeat(2),
  }, tokenTitular);
  ok('usuário comum não publica documento → 403', r.status === 403, r.corpo);

  r = await req('GET', '/lgpd/documentos/termos_de_uso');
  ok('termos são legíveis SEM login → 200', r.status === 200, r.corpo);
  ok('e trazem o texto integral', typeof r.corpo?.dados?.conteudo === 'string', Object.keys(r.corpo?.dados || {}));

  r = await req('GET', '/lgpd/consentimentos/pendencias', null, tokenTitular);
  ok('detecta consentimento desatualizado após nova versão', r.corpo?.dados?.pendentes?.some((p) => p.tipo === 'termos_de_uso' && p.motivo === 'consentimento_desatualizado' || p.motivo === 'nunca_aceito'), r.corpo?.dados);
  ok('expõe se o reaceite é obrigatório (o front pede o aceite)', typeof r.corpo?.dados?.bloqueia === 'boolean', r.corpo?.dados);

  r = await req('GET', '/lgpd/consentimentos', null, tokenTitular);
  ok('titular vê o histórico dos próprios consentimentos', Array.isArray(r.corpo?.dados?.historico) && r.corpo.dados.historico.length > 0, r.corpo?.dados);

  // ─── solicitações do titular ──────────────────────────────────
  console.log('\n— direitos do titular (art. 18) —');

  r = await req('POST', '/lgpd/solicitacoes', { tipo: 'acesso', descricao: 'Quero saber o que vocês guardam.' }, tokenTitular);
  ok('abre solicitação → 201', r.status === 201, r.corpo);
  const solicitacaoId = r.corpo?.dados?.id;
  const prazo = r.corpo?.dados?.prazoEm ? Math.round((new Date(r.corpo.dados.prazoEm) - Date.now()) / 86400000) : null;
  ok('prazo legal de 15 dias já nasce calculado', prazo === 15 || prazo === 14, prazo);

  r = await req('POST', '/lgpd/solicitacoes', { tipo: 'acesso' }, tokenTitular);
  ok('segunda solicitação do mesmo tipo em aberto → 409', r.status === 409, r.corpo);

  /* VETOR DE SEGURANÇA: pedir sobre dados de outra pessoa */
  r = await req('POST', '/lgpd/solicitacoes', { tipo: 'acesso', usuarioId: usuarioOutro.id }, tokenTitular);
  ok('solicitar sobre dados de TERCEIRO → 403', r.status === 403, r.corpo);
  const vazou = await db.SolicitacaoTitular.count({ where: { usuario_id: usuarioOutro.id } });
  ok('e nada foi criado no nome do terceiro', vazou === 0, vazou);

  r = await req('POST', '/lgpd/solicitacoes', { tipo: 'inventado' }, tokenTitular);
  ok('tipo fora do enum → 422', r.status === 422, r.corpo);

  r = await req('GET', '/lgpd/solicitacoes/minhas', null, tokenTitular);
  ok('titular acompanha as próprias solicitações', r.status === 200 && r.corpo.dados.length >= 1, r.corpo);

  /* o papel `usuario` tem `lgpd.ler_solicitacoes.propria`: ele enxerga a fila,
     mas o escopo precisa reduzi-la às dele — nada de solicitação alheia */
  r = await req('GET', '/lgpd/solicitacoes', null, tokenTitular);
  ok('escopo próprio devolve só as solicitações do próprio usuário',
     r.status === 200 && r.corpo.dados.every((s) => s.usuarioId === usuarioTitular.id), r.corpo?.dados?.map((s) => s.usuarioId));

  r = await req('GET', '/lgpd/solicitacoes?vencendo=true', null, tokenDpo);
  ok('encarregado lista a fila com filtro de vencimento → 200', r.status === 200, r.corpo);

  r = await req('GET', '/lgpd/solicitacoes/resumo', null, tokenDpo);
  ok('resumo traz abertas/vencendo/atrasadas', typeof r.corpo?.dados?.abertas === 'number' && r.corpo.dados.prazoDias === 15, r.corpo?.dados);

  r = await req('GET', '/lgpd/solicitacoes/' + solicitacaoId, null, tokenOutro);
  ok('solicitação alheia → 404 (não confirma existência)', r.status === 404, r.corpo);

  r = await req('PATCH', '/lgpd/solicitacoes/' + solicitacaoId, { status: 'concluida', resposta: 'Segue a relação dos dados tratados.' }, tokenOutro);
  ok('usuário comum não responde solicitação → 403', r.status === 403, r.corpo);

  r = await req('PATCH', '/lgpd/solicitacoes/' + solicitacaoId, { status: 'concluida', resposta: 'Segue a relação dos dados tratados.' }, tokenDpo);
  ok('encarregado responde → 200', r.status === 200 && r.corpo.dados.status === 'concluida', r.corpo);

  const acessoRegistrado = await db.LogAcessoDado.count({ where: { ator_id: usuarioDpo.id, titular_id: usuarioTitular.id } });
  ok('atendimento gravou acesso a dado pessoal de terceiro', acessoRegistrado > 0, acessoRegistrado);

  r = await req('PATCH', '/lgpd/solicitacoes/' + solicitacaoId, { status: 'recusada', resposta: 'Tentando responder de novo.' }, tokenDpo);
  ok('solicitação encerrada não aceita nova resposta → 409', r.status === 409, r.corpo);

  // ─── exportação de dados ──────────────────────────────────────
  console.log('\n— exportação de dados —');

  r = await req('POST', '/lgpd/exportacoes/confirmar', { codigo: '123456' }, tokenTitular);
  ok('confirmar sem ter pedido → 400 (código inválido)', r.status === 400, r.corpo);

  r = await req('POST', '/lgpd/exportacoes', {}, tokenTitular);
  ok('exportação SEM confirmação de senha → 422', r.status === 422, r.corpo);

  r = await req('POST', '/lgpd/exportacoes', { senha: 'SenhaErrada999' }, tokenTitular);
  ok('token válido + senha errada NÃO exporta → 401', r.status === 401, r.corpo);

  r = await req('POST', '/lgpd/exportacoes', { senha: 'SenhaForte123' }, tokenTitular);
  ok('reautenticação correta dispara o código → 200', r.status === 200 && r.corpo.dados.confirmacaoEnviada, r.corpo);

  r = await req('POST', '/lgpd/exportacoes/confirmar', { codigo: '000000' }, tokenTitular);
  ok('código errado → 400', r.status === 400, r.corpo);

  /* o código só existe em hash no banco; emitir daqui é o equivalente a lê-lo
     na caixa de entrada do titular */
  const { codigo } = await tokenService.emitir({
    usuarioId: usuarioTitular.id,
    tipo: 'otp_login',
    destino: titular.email,
    minutos: 15,
    contexto: { ipHash: null, userAgent: 'teste' },
  });

  r = await req('POST', '/lgpd/exportacoes/confirmar', { codigo }, tokenTitular);
  ok('com senha + código → 202 e vai para a fila', r.status === 202 && r.corpo.dados.status === 'em_processamento', r.corpo);
  const protocoloExport = r.corpo?.dados?.solicitacaoId;
  const registroExport = await db.SolicitacaoTitular.findByPk(protocoloExport);
  ok('protocolo de portabilidade registrado com identidade verificada', registroExport?.tipo === 'portabilidade' && !!registroExport?.identidade_verificada_em, registroExport?.tipo);

  r = await req('POST', '/lgpd/exportacoes/confirmar', { codigo }, tokenTitular);
  ok('o mesmo código não serve duas vezes → 400', r.status === 400, r.corpo);

  const conteudoPacote = await pacote.montar(usuarioTitular.id);
  ok('pacote traz conta, perfil, anúncios, consentimentos', ['conta', 'perfil', 'anuncios', 'consentimentos', 'favoritos', 'mensagensQueEnviei'].every((c) => c in conteudoPacote), Object.keys(conteudoPacote));
  ok('pacote NÃO contém senha em nenhuma forma', !JSON.stringify(conteudoPacote).includes('senha_hash') && !JSON.stringify(conteudoPacote).includes('$2b$'), 'vazou hash de senha');
  ok('pacote NÃO contém ip_hash', !JSON.stringify(conteudoPacote).includes('ip_hash'), 'vazou ip_hash');

  // ─── link temporário de uso único ─────────────────────────────
  console.log('\n— link de download —');

  const { caminho } = await link.guardar(Buffer.from('{"teste":true}', 'utf8'), { pasta: 'lgpd/testes', extensao: 'json' });
  const bilhete = await link.criar({ caminho, donoId: usuarioTitular.id, nomeArquivo: 'teste.json', rota: '/v1/lgpd/downloads' });

  r = await req('GET', '/lgpd/downloads/' + bilhete.token, null, tokenOutro);
  ok('link de outra pessoa → 404', r.status === 404, r.corpo);

  r = await req('GET', '/lgpd/downloads/' + bilhete.token, null, tokenTitular);
  ok('dono baixa o pacote → 200', r.status === 200, r.corpo);

  r = await req('GET', '/lgpd/downloads/' + bilhete.token, null, tokenTitular);
  ok('link é de USO ÚNICO: segunda vez → 404', r.status === 404, r.corpo);

  // ─── anonimização ─────────────────────────────────────────────
  console.log('\n— anonimização (art. 18, VI) —');
  /* o limite da rota é por hora e conta as recusas; zerar aqui isola o bloco */
  await limparLimites();

  /* monta o cenário que a anonimização não pode quebrar: um anúncio do titular
     e uma conversa em que a OUTRA pessoa tem histórico */
  const perfilTitular = await db.Perfil.findOne({ where: { usuario_id: usuarioTitular.id } });
  const anuncio = await db.Anuncio.create({
    codigo: 'T' + String(marca).slice(-8),
    usuario_id: usuarioTitular.id,
    perfil_id: perfilTitular.id,
    tipo: 'peca',
    titulo: 'Bomba injetora de teste',
    titulo_normalizado: 'bomba injetora de teste',
    slug: 'bomba-injetora-teste-' + marca,
    descricao: 'Anúncio criado pelo teste de anonimização.',
    preco_a_combinar: true,
    status: 'publicado',
    publicado_em: new Date(),
  });

  const conversa = await db.Conversa.create({
    anuncio_id: anuncio.id,
    anunciante_id: usuarioTitular.id,
    interessado_id: usuarioOutro.id,
    status: 'aberta',
  });
  await db.ConversaParticipante.bulkCreate([
    { conversa_id: conversa.id, usuario_id: usuarioTitular.id, papel: 'anunciante' },
    { conversa_id: conversa.id, usuario_id: usuarioOutro.id, papel: 'interessado' },
  ]);
  const mensagemDoOutro = await db.Mensagem.create({
    conversa_id: conversa.id,
    remetente_id: usuarioOutro.id,
    tipo: 'texto',
    conteudo: 'Ainda tem essa bomba injetora?',
  });

  r = await req('POST', '/lgpd/anonimizacao', { senha: 'SenhaForte123' }, tokenTitular);
  ok('anonimizar sem a frase de confirmação → 422', r.status === 422, r.corpo);

  r = await req('POST', '/lgpd/anonimizacao', { confirmacao: 'ANONIMIZAR MINHA CONTA', senha: 'SenhaErrada999' }, tokenTitular);
  ok('anonimizar com senha errada → 401', r.status === 401, r.corpo);

  /* VETOR DE SEGURANÇA: anonimizar conta alheia sem `usuario.anonimizar` */
  r = await req('POST', '/lgpd/anonimizacao', { usuarioId: usuarioTitular.id, confirmacao: 'ANONIMIZAR MINHA CONTA', senha: 'SenhaForte123' }, tokenOutro);
  ok('anonimizar conta ALHEIA sem permissão → 403', r.status === 403, r.corpo);
  const aindaViva = await db.Usuario.findByPk(usuarioTitular.id);
  ok('e a conta continua intacta', !aindaViva.anonimizado_em, aindaViva.anonimizado_em);

  r = await req('POST', '/lgpd/anonimizacao', { confirmacao: 'ANONIMIZAR MINHA CONTA', senha: 'SenhaForte123' }, tokenTitular);
  ok('titular anonimiza a própria conta → 202 (vai para a fila)', r.status === 202 && r.corpo.dados.irreversivel === true, r.corpo);

  /* executa o job na hora: sem worker rodando, a fila não seria processada */
  const resultado = await anonimizacao.executar(usuarioTitular.id, { motivo: 'teste automatizado', solicitadoPor: usuarioTitular.id });
  ok('job de anonimização concluiu', resultado.anonimizado === true, resultado);

  const anonimizado = await db.Usuario.findByPk(usuarioTitular.id, { paranoid: false });
  ok('nome virou marcador, não sumiu', anonimizado.nome === 'Usuário removido', anonimizado.nome);
  ok('e-mail deixou de ser identificável', anonimizado.email.includes('@removido.invalido'), anonimizado.email);
  ok('senha eliminada', anonimizado.senha_hash === null, 'senha ainda presente');
  ok('prazo de retenção registrado', !!anonimizado.excluir_definitivamente_em, anonimizado.excluir_definitivamente_em);

  const perfilDepois = await db.Perfil.findOne({ where: { usuario_id: usuarioTitular.id } });
  ok('documento (CPF/CNPJ) eliminado do perfil', perfilDepois.documento === null, perfilDepois.documento);
  ok('slug público neutralizado', perfilDepois.slug.startsWith('usuario-removido-'), perfilDepois.slug);

  /* INTEGRIDADE REFERENCIAL — o ponto central da anonimização */
  const anuncioDepois = await db.Anuncio.findByPk(anuncio.id, { paranoid: false });
  ok('anúncio NÃO foi apagado, só saiu do ar', !!anuncioDepois && anuncioDepois.status === 'removido', anuncioDepois?.status);

  const conversaDepois = await db.Conversa.findByPk(conversa.id, { paranoid: false });
  ok('conversa da outra parte continua existindo', !!conversaDepois, 'conversa sumiu');

  const mensagemDepois = await db.Mensagem.findByPk(mensagemDoOutro.id, { paranoid: false });
  ok('mensagem da outra parte continua legível', mensagemDepois?.conteudo === 'Ainda tem essa bomba injetora?', mensagemDepois?.conteudo);

  const participacao = await db.ConversaParticipante.count({ where: { conversa_id: conversa.id } });
  ok('participantes da conversa preservados', participacao === 2, participacao);

  const consentimentosDepois = await db.Consentimento.count({ where: { usuario_id: usuarioTitular.id } });
  ok('consentimentos preservados (prova exigida por lei)', consentimentosDepois > 0, consentimentosDepois);

  const sessoesDepois = await db.Sessao.count({ where: { usuario_id: usuarioTitular.id } });
  ok('sessões encerradas', sessoesDepois === 0, sessoesDepois);

  const trilhaAnonimizacao = await db.LogAuditoria.count({ where: { entidade: 'usuario', entidade_id: usuarioTitular.id, acao: 'remover' } });
  ok('anonimização registrada em auditoria', trilhaAnonimizacao > 0, trilhaAnonimizacao);

  const repetida = await anonimizacao.executar(usuarioTitular.id, {});
  ok('anonimizar duas vezes é inofensivo', repetida.anonimizado === false && repetida.motivo === 'ja_anonimizado', repetida);

  console.log(falhas === 0 ? '\n✅ lgpd: todos os testes passaram' : `\n❌ lgpd: ${falhas} falha(s)`);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
