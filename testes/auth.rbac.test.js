'use strict';

/**
 * Escopo de permissão, poder do Admin e estado de conta, pela rede.
 *
 *   npm run test:rbac
 */

const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');
const app=require(RAIZ+'/app'); const db=require(RAIZ+'/src/models');
const { sincronizar }=require(RAIZ+'/src/rbac');
let server, base;
const req=async(m,c,b,t)=>{const r=await fetch(base+c,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});return{status:r.status,corpo:await r.json().catch(()=>null)};};
const ok=(n,c,e)=>console.log((c?'  ok  ':' FALHA')+' '+n+(c?'':' → '+JSON.stringify(e)));
(async()=>{
 await limparLimites();
  server=app.listen(0); base='http://127.0.0.1:'+server.address().port+'/api/v1/auth';
  const cadastrar=async(sufixo,tipo)=>{
    const email=`${sufixo}${Date.now()}@agropecas.dev`;
    const r=await req('POST','/registrar',{nome:'Fulano '+sufixo,email,senha:'SenhaForte123',tipoPerfil:tipo,aceiteTermos:true,aceitePrivacidade:true});
    return {email, ...r.corpo.dados};
  };
  const a=await cadastrar('umA','produtor'); const b=await cadastrar('doisB','prestador');
  console.log('\n— escopo próprio × todos —');
  const sessaoDeB=(await req('GET','/sessoes',null,b.tokens.acesso)).corpo.dados[0];
  let r=await req('DELETE','/sessoes/'+sessaoDeB.id,null,a.tokens.acesso);
  ok('usuário comum não encerra sessão de terceiro → 403', r.status===403, r.corpo);
  ok('permissão que ele tem é a de escopo próprio', a.permissoes.includes('usuario.encerrar_sessoes.proprio') && !a.permissoes.includes('usuario.encerrar_sessoes.todos'), a.permissoes.filter(p=>p.startsWith('usuario.encerrar')));

  console.log('\n— admin manda em tudo —');
  const usuarioA=await db.Usuario.findOne({where:{email_normalizado:a.email.toLowerCase()}});
  if(!usuarioA) throw new Error('usuário A não encontrado para '+a.email);
  const papelAdmin=await db.Papel.findOne({where:{chave:'admin'}});
  await db.UsuarioPapel.create({usuario_id:usuarioA.id,papel_id:papelAdmin.id});
  const relogin=await req('POST','/entrar',{email:a.email,senha:'SenhaForte123'});
  const tokenAdmin=relogin.corpo.dados.tokens.acesso;
  ok('papel novo vale na hora (permissão lida do banco, não do token)', relogin.corpo.dados.papeis.includes('admin'), relogin.corpo.dados.papeis);
  r=await req('DELETE','/sessoes/'+sessaoDeB.id,null,tokenAdmin);
  ok('admin encerra sessão de terceiro → 200', r.status===200, r.corpo);
  r=await req('GET','/eu',null,b.tokens.acesso);
  ok('sessão do outro morreu de verdade', r.status===401, r.corpo);

  console.log('\n— conta suspensa/banida —');
  const usuarioB=await db.Usuario.findOne({where:{email_normalizado:b.email.toLowerCase()}});
  await usuarioB.update({status:'banido',motivo_status:'teste'});
  r=await req('POST','/entrar',{email:b.email,senha:'SenhaForte123'});
  ok('login de conta banida → 423', r.status===423, r.corpo);
  await usuarioB.update({status:'suspenso',suspenso_ate:new Date(Date.now()-1000)});
  r=await req('POST','/entrar',{email:b.email,senha:'SenhaForte123'});
  ok('suspensão vencida reativa sozinha → 200', r.status===200, r.corpo);

  console.log('\n— catálogo RBAC —');
  const rel=await sincronizar(db);
  ok('sincronizar é idempotente (nada novo na 2ª vez)', rel.criadasPermissoes===0 && rel.criadosPapeis===0, rel);

  server.close(); await db.sequelize.close(); await encerrarInfra();
})().catch(e=>{console.error('ERRO:',e);server?.close();process.exit(1);});
