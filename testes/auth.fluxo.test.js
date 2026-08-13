'use strict';

/**
 * Fluxo do auth de ponta a ponta, contra a API e o banco de verdade.
 * Não é unitário de propósito: o que interessa aqui é o comportamento
 * observável pela rede, que é o que o front e um atacante veem.
 *
 *   npm run test:auth
 */

process.env.NODE_ENV='development';
const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');
const app = require(RAIZ + '/app');
const db = require(RAIZ + '/src/models');



let server, base;
const req = async (metodo, caminho, corpo, token) => {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};
// CNPJ válido e diferente a cada execução: documento é único no banco, então
// um valor fixo faria o teste passar só na primeira vez
function cnpjValido() {
  const base = Array.from({length:12},(_,i)=> i<8 ? Math.floor(Math.random()*10) : [0,0,0,1][i-8]);
  const dv = (nums) => {
    let peso = nums.length - 7, soma = 0;
    for (let i = 0; i < nums.length; i++) { soma += nums[i] * peso--; if (peso < 2) peso = 9; }
    const r = soma % 11; return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base); const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

const ok = (nome, cond, extra) => console.log((cond ? '  ok  ' : ' FALHA') + ' ' + nome + (cond ? '' : ' → ' + JSON.stringify(extra)));

(async () => {
  await limparLimites();
  server = app.listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api/v1/auth';
  const email = `teste${Date.now()}@agropecas.dev`;

  console.log('\n— cadastro —');
  let r = await req('POST', '/registrar', { nome:'joão da silva teste', email, senha:'SenhaForte123', telefone:'(65) 99999-1234', whatsapp:'65999991234', tipoPerfil:'loja', nomeExibicao:'Auto Peças Teste', documento:cnpjValido(), razaoSocial:'Auto Peças Teste LTDA', aceiteTermos:true, aceitePrivacidade:true, comunicacao_marketing:false });
  ok('registra e devolve 201', r.status===201, r.corpo);
  ok('não vaza senha_hash', !JSON.stringify(r.corpo).includes('senha_hash'));
  ok('cria perfil loja com slug', /^auto-pecas-teste(-\d+)?$/.test(r.corpo?.dados?.perfil?.slug||''), r.corpo?.dados?.perfil);
  ok('papel usuario atribuído', r.corpo?.dados?.papeis?.includes('usuario'), r.corpo?.dados?.papeis);
  ok('tem tokens', !!r.corpo?.dados?.tokens?.acesso && !!r.corpo?.dados?.tokens?.refresh);
  const token = r.corpo.dados.tokens.acesso, refresh = r.corpo.dados.tokens.refresh;

  r = await req('POST','/registrar',{ nome:'Nome Valido', email, senha:'SenhaForte123', tipoPerfil:'loja', aceiteTermos:true, aceitePrivacidade:true });
  ok('e-mail duplicado → 409', r.status===409, r.corpo);
  r = await req('POST','/registrar',{ nome:'y', email:'novo'+email, senha:'123', tipoPerfil:'x' });
  ok('validação agrega campos → 422', r.status===422 && Object.keys(r.corpo.erro.detalhe.campos).length>=3, r.corpo);
  r = await req('POST','/registrar',{ nome:'y', email:'sem-aceite'+email, senha:'SenhaForte123', tipoPerfil:'loja', aceiteTermos:true });
  ok('sem aceite de privacidade → 422', r.status===422, r.corpo);

  console.log('\n— login —');
  r = await req('POST','/entrar',{ email, senha:'SenhaForte123' });
  ok('login correto → 200', r.status===200, r.corpo);
  r = await req('POST','/entrar',{ email, senha:'errada' });
  ok('senha errada → 401', r.status===401, r.corpo);
  r = await req('POST','/entrar',{ email:'naoexiste@x.com', senha:'errada' });
  ok('conta inexistente → mesma resposta 401', r.status===401 && r.corpo.erro.codigo==='CREDENCIAL_INVALIDA', r.corpo);

  console.log('\n— sessão —');
  r = await req('GET','/eu',null,token);
  ok('/eu com token → 200', r.status===200, r.corpo);
  ok('/eu traz permissões', (r.corpo?.dados?.permissoes||[]).length>0);
  r = await req('GET','/eu');
  ok('/eu sem token → 401', r.status===401, r.corpo);
  r = await req('GET','/eu',null,'token.falso.aqui');
  ok('token inválido → 401', r.status===401, r.corpo);

  r = await req('POST','/renovar',{ refreshToken: refresh });
  ok('renova → 200 com novo par', r.status===200 && r.corpo.dados.tokens.refresh!==refresh, r.corpo);
  const refresh2 = r.corpo.dados.tokens.refresh;

  // reuso do token já rotacionado em sessão DESCARTÁVEL: hoje isso derruba a
  // sessão inteira (detecção de roubo), então não pode ser feito na sessão
  // que o resto do teste usa
  const descartavel = await req('POST','/entrar',{ email, senha:'SenhaForte123' });
  const rd = descartavel.corpo.dados.tokens.refresh;
  await req('POST','/renovar',{ refreshToken: rd });
  r = await req('POST','/renovar',{ refreshToken: rd });
  ok('refresh antigo não vale mais (rotação)', r.status===401, r.corpo);
  const sessaoMorta = await db.Sessao.findOne({ where:{ reutilizacao_detectada_em: { [db.Sequelize.Op.ne]: null } } });
  ok('reuso derruba a sessão inteira (detecção de roubo)', !!sessaoMorta && !!sessaoMorta.revogada_em, sessaoMorta?.revogada_motivo);

  r = await req('GET','/sessoes',null,token);
  ok('lista sessões e marca a atual', r.status===200 && r.corpo.dados.some(s=>s.atual), r.corpo);
  const outra = r.corpo.dados.find(s=>!s.atual);

  console.log('\n— escopo RBAC —');
  const alheia = await db.Sessao.findOne({ where: { usuario_id: { [db.Sequelize.Op.ne]: (await db.Usuario.findOne({where:{email_normalizado:email}})).id } } });
  if (alheia) { r = await req('DELETE','/sessoes/'+alheia.id,null,token); ok('encerrar sessão de terceiro → 403', r.status===403, r.corpo); }
  else console.log('  --  sem sessão de terceiro para testar (ok)');
  if (outra) { r = await req('DELETE','/sessoes/'+outra.id,null,token); ok('encerrar sessão própria → 200', r.status===200, r.corpo); }

  console.log('\n— verificação de e-mail —');
  const usuario = await db.Usuario.findOne({ where: { email_normalizado: email } });
  ok('conta nasce pendente', usuario.status==='pendente', usuario.status);
  r = await req('POST','/email/confirmar',{ email, codigo:'000000' });
  ok('código errado → 400 genérico', r.status===400 && r.corpo.erro.codigo==='REQUISICAO_INVALIDA', r.corpo);
  const tk = await db.TokenVerificacao.findOne({ where:{ usuario_id: usuario.id, tipo:'verificacao_email' }, order:[['criado_em','DESC']] });
  ok('código guardado em hash', tk && tk.codigo_hash.length===64);

  console.log('\n— recuperação de senha —');
  r = await req('POST','/senha/solicitar',{ email });
  ok('solicita → 200 com destino mascarado', r.status===200 && r.corpo.dados.destino.includes('*'), r.corpo);
  r = await req('POST','/senha/solicitar',{ email:'inexistente@x.com' });
  ok('e-mail inexistente → mesma resposta', r.status===200, r.corpo);
  const otp = await db.TokenVerificacao.findOne({ where:{ usuario_id: usuario.id, tipo:'recuperacao_senha', usado_em:null }, order:[['criado_em','DESC']] });
  ok('OTP emitido', !!otp);

  console.log('\n— troca de senha (logado) —');
  // segunda sessão, em outro "aparelho": é ela que deve morrer na troca
  const outroLogin = await req('POST','/entrar',{ email, senha:'SenhaForte123' });
  const refreshOutroAparelho = outroLogin.corpo.dados.tokens.refresh;
  r = await req('PATCH','/senha',{ senhaAtual:'errada', senha:'OutraSenha456' },token);
  ok('senha atual errada → 422', r.status===422, r.corpo);
  r = await req('PATCH','/senha',{ senhaAtual:'SenhaForte123', senha:'SenhaForte123' },token);
  ok('nova igual à atual → 422', r.status===422, r.corpo);
  r = await req('PATCH','/senha',{ senhaAtual:'SenhaForte123', senha:'OutraSenha456' },token);
  ok('troca válida → 200', r.status===200, r.corpo);
  r = await req('POST','/entrar',{ email, senha:'OutraSenha456' });
  ok('entra com a senha nova', r.status===200, r.corpo);
  const tokenNovo = r.corpo.dados.tokens.acesso;
  r = await req('POST','/renovar',{ refreshToken: refreshOutroAparelho });
  ok('troca de senha revogou a sessão do outro aparelho', r.status===401, r.corpo);
  r = await req('GET','/eu',null,token);
  ok('sessão atual sobreviveu à própria troca', r.status===200, r.corpo);

  console.log('\n— consentimentos (LGPD) —');
  r = await req('GET','/consentimentos',null,tokenNovo);
  ok('registra aceites do cadastro', r.status===200 && r.corpo.dados.length>=2, r.corpo);
  ok('base legal correta nos obrigatórios', r.corpo.dados.filter(c=>c.tipo==='termos_de_uso')[0]?.baseLegal==='execucao_contrato', r.corpo.dados);
  r = await req('PATCH','/consentimentos',{ tipo:'comunicacao_marketing', aceito:false },tokenNovo);
  ok('revoga sem apagar histórico', r.status===200, r.corpo);
  const total = await db.Consentimento.count({ where:{ usuario_id: usuario.id } });
  ok('histórico só cresce', total>=3, total);

  console.log('\n— bloqueio por tentativas —');
  // direto no service: o rate-limit por IP (outra camada) barraria antes
  const loginService = require(RAIZ + '/src/features/auth/auth.login.service');
  const registroService = require(RAIZ + '/src/features/auth/auth.registro.service');
  const alvo = `bloq${Date.now()}@agropecas.dev`;
  const ctx = { ipHash: 'a'.repeat(64), userAgent: 'teste', origem: 'web' };
  await registroService.criar({ nome:'bloq teste', email:alvo, senha:'SenhaForte123', tipoPerfil:'produtor', consentimentos:[{tipo:'termos_de_uso',aceito:true},{tipo:'politica_privacidade',aceito:true}] }, ctx);
  let capturado;
  for (let i=0;i<6;i++) {
    capturado = await loginService.entrar({ email:alvo, senha:'errada' }, ctx).then(()=>null).catch(e=>e);
  }
  ok('conta bloqueia após o limite → 423', capturado?.statusCode===423, capturado?.message);
  capturado = await loginService.entrar({ email:alvo, senha:'SenhaForte123' }, ctx).then(()=>null).catch(e=>e);
  ok('bloqueio vale mesmo com a senha certa', capturado?.statusCode===423, capturado?.message);

  console.log('\n— logout —');
  r = await req('POST','/sair',null,tokenNovo);
  ok('sair → 204', r.status===204, r.corpo);
  r = await req('GET','/eu',null,tokenNovo);
  ok('token do access morre com a sessão revogada', r.status===401, r.corpo);

  console.log('\n— auditoria —');
  const logs = await db.LogAuditoria.count({ where:{ entidade:'usuarios' } });
  ok('gravou trilha de auditoria', logs>0, logs);
  const comIp = await db.LogAuditoria.findOne({ where:{ entidade:'usuarios' } });
  ok('IP só em hash', !comIp.ip_hash || comIp.ip_hash.length===64, comIp.ip_hash);

  server.close(); await db.sequelize.close(); await encerrarInfra();
})().catch(e => { console.error('\nERRO NO TESTE:', e); server?.close(); process.exit(1); });
