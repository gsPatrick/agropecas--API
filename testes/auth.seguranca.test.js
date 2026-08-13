'use strict';

/**
 * Auditoria de segurança do auth: cada bloco tenta invadir de um jeito.
 * "BLOQUEADO" é o resultado desejado — um "PASSOU" é uma falha aberta.
 *
 *   npm run test:seguranca
 */

const RAIZ = require('path').resolve(__dirname, '..');
const { limparLimites, encerrarInfra } = require('./apoio');
const app=require(RAIZ+'/app'); const db=require(RAIZ+'/src/models');
const jwt=require(RAIZ+'/node_modules/jsonwebtoken'); const crypto=require('crypto');
let server, base;
const req=async(m,c,b,t)=>{const r=await fetch(base+c,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});return{status:r.status,corpo:await r.json().catch(()=>null)};};
const R=[];
const ok=(n,c,e)=>{R.push(c);console.log((c?'  BLOQUEADO ':'  ⚠️ PASSOU  ')+n+(c?'':' → '+JSON.stringify(e).slice(0,220)));};

(async()=>{
 await limparLimites();
 server=app.listen(0); base='http://127.0.0.1:'+server.address().port+'/api/v1/auth';
 const novo=async(s)=>{const email=`${s}${Date.now()}${Math.random().toString(36).slice(2,6)}@x.dev`;
   const r=await req('POST','/registrar',{nome:'Fulano Teste',email,senha:'SenhaForte123',tipoPerfil:'produtor',aceiteTermos:true,aceitePrivacidade:true});
   return {email, ...r.corpo.dados};};
 const vitima=await novo('vitima'); const atacante=await novo('atacante');
 const idVitima=vitima.usuario.id;

 console.log('\n══ FORJA DE TOKEN ══');
 let t=jwt.sign({sub:idVitima,tipo:'acesso'},'segredo-errado',{issuer:'agropecas-api',audience:'agropecas-web',expiresIn:'1h'});
 let r=await req('GET','/eu',null,t); ok('token assinado com outro segredo', r.status===401, r.corpo);

 const [h,p]=vitima.tokens.acesso.split('.');
 t=Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')+'.'+p+'.';
 r=await req('GET','/eu',null,t); ok('alg:none (confusão de algoritmo)', r.status===401, r.corpo);

 t=jwt.sign({sub:idVitima,tipo:'acesso'},require(RAIZ+'/src/config').seguranca.jwtSecret,{expiresIn:'1h'});
 r=await req('GET','/eu',null,t); ok('token sem issuer/audience corretos', r.status===401, r.corpo);

 const seg=require(RAIZ+'/src/config').seguranca.jwtSecret;
 t=jwt.sign({sub:idVitima,tipo:'acesso'},seg,{issuer:'agropecas-api',audience:'agropecas-web',expiresIn:'-1h'});
 r=await req('GET','/eu',null,t); ok('token expirado', r.status===401, r.corpo);

 // token válido, assinatura certa, MAS sem sid (sem sessão)
 t=jwt.sign({sub:idVitima,tipo:'acesso'},seg,{issuer:'agropecas-api',audience:'agropecas-web',expiresIn:'1h'});
 r=await req('GET','/eu',null,t); ok('token válido SEM sessão vinculada (sid ausente)', r.status===401, r.corpo);

 // sid de outra pessoa
 const sessAt=await db.Sessao.findOne({where:{usuario_id:atacante.usuario.id}});
 t=jwt.sign({sub:idVitima,sid:sessAt.id,tipo:'acesso'},seg,{issuer:'agropecas-api',audience:'agropecas-web',expiresIn:'1h'});
 r=await req('GET','/eu',null,t);
 ok('sub da vítima + sid do atacante (sessão não confere com o usuário)', r.status===401, r.corpo?.dados?.usuario?.email);

 console.log('\n══ REVOGAÇÃO ══');
 const v2=await req('POST','/entrar',{email:vitima.email,senha:'SenhaForte123'});
 const tA=v2.corpo.dados.tokens.acesso, rA=v2.corpo.dados.tokens.refresh;
 await req('POST','/sair',null,tA);
 r=await req('GET','/eu',null,tA); ok('access token após logout', r.status===401, r.corpo);
 r=await req('POST','/renovar',{refreshToken:rA}); ok('refresh token após logout', r.status===401, r.corpo);

 const v3=await req('POST','/entrar',{email:vitima.email,senha:'SenhaForte123'});
 const rB=v3.corpo.dados.tokens.refresh;
 const rot=await req('POST','/renovar',{refreshToken:rB});
 const rC=rot.corpo.dados.tokens.refresh;
 r=await req('POST','/renovar',{refreshToken:rB}); ok('reuso do refresh já rotacionado', r.status===401, r.corpo);
 r=await req('POST','/renovar',{refreshToken:rC});
 ok('DETECÇÃO DE ROUBO: sessão morre após reuso do refresh antigo', r.status===401, 'sessão continuou viva após reuso detectado');

 console.log('\n══ ACESSO A DADO DE TERCEIRO ══');
 const sessVit=await db.Sessao.findOne({where:{usuario_id:idVitima,revogada_em:null}});
 if(sessVit){r=await req('DELETE','/sessoes/'+sessVit.id,null,atacante.tokens.acesso); ok('encerrar sessão da vítima', r.status===403, r.corpo);}
 r=await req('GET','/sessoes',null,atacante.tokens.acesso);
 ok('listagem de sessões só devolve as próprias', r.corpo.dados.every(s=>true) && (await db.Sessao.count({where:{usuario_id:atacante.usuario.id,revogada_em:null}}))===r.corpo.dados.length, r.corpo.dados.length);
 r=await req('PATCH','/consentimentos',{tipo:'comunicacao_marketing',aceito:true,usuario_id:idVitima},atacante.tokens.acesso);
 const vazou=await db.Consentimento.count({where:{usuario_id:idVitima,tipo:'comunicacao_marketing'}});
 ok('mass assignment de usuario_id no corpo', vazou===0, 'escreveu consentimento na conta da vítima');

 console.log('\n══ ESCALADA DE PRIVILÉGIO ══');
 r=await req('POST','/registrar',{nome:'Hacker Tal',email:'esc'+Date.now()+'@x.dev',senha:'SenhaForte123',tipoPerfil:'produtor',aceiteTermos:true,aceitePrivacidade:true,papeis:['admin'],status:'ativo',email_verificado_em:new Date(),verificado_em:new Date()});
 const criado=r.corpo.dados;
 ok('papel admin injetado no cadastro', !criado.papeis.includes('admin'), criado.papeis);
 ok('status forçado para ativo no cadastro', criado.usuario.status==='pendente', criado.usuario.status);
 ok('selo de verificado forçado no cadastro', criado.perfil.verificado===false, criado.perfil);
 ok('e-mail marcado como verificado no cadastro', criado.usuario.emailVerificado===false, criado.usuario);

 console.log('\n══ VAZAMENTO DE DADOS ══');
 const bruto=JSON.stringify(criado);
 ok('senha_hash fora da resposta', !bruto.includes('senha_hash') && !bruto.includes('$2'), 'hash na resposta');
 ok('ip_hash fora da resposta', !bruto.includes('ip_hash'));
 ok('observacoes_internas fora da resposta', !bruto.includes('observacoes_internas'));
 r=await req('GET','/eu',null,criado.tokens.acesso);
 ok('/eu não expõe campos internos', !JSON.stringify(r.corpo).match(/senha_hash|observacoes_internas|token_hash/), Object.keys(r.corpo.dados.usuario));

 console.log('\n══ CONTA INATIVA ══');
 const alvo=await db.Usuario.findByPk(criado.usuario.id);
 const tokenAlvo=criado.tokens.acesso;
 await alvo.update({status:'banido'});
 r=await req('GET','/eu',null,tokenAlvo); ok('token de conta BANIDA em requisição seguinte', r.status===423, r.corpo);
 await alvo.update({status:'ativo'}); await alvo.destroy(); // soft delete
 r=await req('GET','/eu',null,tokenAlvo); ok('token de conta REMOVIDA (soft delete)', r.status===401||r.status===423, r.corpo);
 r=await req('POST','/entrar',{email:criado.usuario.email,senha:'SenhaForte123'}); ok('login em conta removida', r.status>=400, r.corpo);

 console.log('\n══ ENUMERAÇÃO DE CONTAS ══');
 const cron=async(email)=>{const i=process.hrtime.bigint(); await req('POST','/entrar',{email,senha:'SenhaQualquer999'}); return Number(process.hrtime.bigint()-i)/1e6;};
 let existe=0, naoExiste=0;
 for(let i=0;i<4;i++){ existe+=await cron(vitima.email); naoExiste+=await cron('nao-existe-'+i+'@x.dev'); }
 const dif=Math.abs(existe-naoExiste)/4;
 ok(`enumeração por TEMPO (dif média ${dif.toFixed(0)}ms)`, dif<80, `conta existente responde ~${(existe/4).toFixed(0)}ms vs inexistente ~${(naoExiste/4).toFixed(0)}ms`);
 const r1=await req('POST','/entrar',{email:vitima.email,senha:'errada!!'});
 const r2=await req('POST','/entrar',{email:'ninguem@x.dev',senha:'errada!!'});
 ok('enumeração por MENSAGEM no login', r1.corpo.erro.codigo===r2.corpo.erro.codigo, {a:r1.corpo.erro,b:r2.corpo.erro});
 const r3=await req('POST','/registrar',{nome:'Outro Nome',email:vitima.email,senha:'SenhaForte123',tipoPerfil:'produtor',aceiteTermos:true,aceitePrivacidade:true});
 ok('enumeração pelo CADASTRO', r3.status!==409, 'cadastro confirma que o e-mail existe (409)');

 console.log('\n══ INJEÇÃO ══');
 r=await req('POST','/entrar',{email:{"$ne":null},senha:{"$ne":null}}); ok('operador de consulta no lugar do e-mail', r.status>=400 && r.status<500, r.corpo);
 r=await req('POST','/entrar',{email:"' OR 1=1 --",senha:'x'}); ok('SQL injection no login', r.status>=400, r.corpo);
 r=await req('GET','/sessoes/../../usuarios',null,atacante.tokens.acesso); // o Express normaliza o caminho antes de rotear, então isto vira /usuarios:
 // qualquer recusa serve (401 sem token, 403 sem permissão, 404 sem rota).
 // O que importa é NÃO devolver dado.
 ok('path traversal na rota', [401,403,404].includes(r.status) && !r.corpo?.dados, r.status);

 console.log('\n══ SEGREDOS ══');
 const cfg=require(RAIZ+'/src/config');
 ok('JWT_SECRET não é o padrão de desenvolvimento', cfg.seguranca.jwtSecret!=='segredo-de-desenvolvimento', 'usando segredo padrão — em produção seria fatal');
 ok('SECURITY_IP_SALT não é o padrão', cfg.seguranca.ipSalt!=='sal-de-desenvolvimento', 'usando sal padrão');

 console.log('\n'+'─'.repeat(60));
 console.log(`${R.filter(Boolean).length}/${R.length} vetores bloqueados`);
 server.close(); await db.sequelize.close(); await encerrarInfra();
})().catch(e=>{console.error('ERRO:',e);server?.close();process.exit(1);});
