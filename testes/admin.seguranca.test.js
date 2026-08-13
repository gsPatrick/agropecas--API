'use strict';

/**
 * Auditoria de segurança do PAINEL ADMINISTRATIVO.
 *
 * O painel concentra o poder que a cliente pediu — e é justamente por isso que
 * precisa da bateria própria. "BLOQUEADO" é o resultado desejado.
 *
 *   npm run test:admin-seguranca
 */

const RAIZ = require('path').resolve(__dirname, '..');
const {limparLimites,encerrarInfra}=require('./apoio');
const app=require(RAIZ+'/app'); const db=require(RAIZ+'/src/models');
let server, base;
const req=async(m,c,b,t)=>{const r=await fetch(base+c,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});return{status:r.status,corpo:await r.json().catch(()=>null)};};
const R=[]; const ok=(n,c,e)=>{R.push(c);console.log((c?'  BLOQUEADO ':'  ⚠️ PASSOU  ')+n+(c?'':' → '+JSON.stringify(e).slice(0,180)));};
const marca=Date.now();

async function conta(sufixo, papelChave){
  const email=`adm${sufixo}${marca}@x.dev`;
  const r=await req('POST','/api/v1/auth/registrar',{nome:'Fulano '+sufixo,email,senha:'SenhaForte123',tipoPerfil:'produtor',aceiteTermos:true,aceitePrivacidade:true});
  const uid=r.corpo.dados.usuario.id;
  if(papelChave){ const p=await db.Papel.findOne({where:{chave:papelChave}}); await db.UsuarioPapel.create({usuario_id:uid,papel_id:p.id}); }
  const l=await req('POST','/api/v1/auth/entrar',{email,senha:'SenhaForte123'});
  return {email, usuarioId:uid, token:l.corpo.dados.tokens.acesso, papeis:l.corpo.dados.papeis};
}

(async()=>{
 await limparLimites(); server=app.listen(0); base='http://127.0.0.1:'+server.address().port;
 const comum=await conta('comum'); const moder=await conta('moder','moderador'); const admin=await conta('admin','admin');
 console.log('papéis →  comum:',comum.papeis,' moderador:',moder.papeis,' admin:',admin.papeis);

 console.log('\n══ A PORTA DO PAINEL ══');
 for (const rota of ['/painel','/usuarios','/anuncios','/denuncias','/auditoria','/configuracoes','/planos','/rbac/papeis','/lgpd/solicitacoes']) {
   const r=await req('GET','/api/v1/admin'+rota,null,comum.token);
   ok(`usuário comum em ${rota}`, r.status===403, r.status);
 }
 const semToken=await req('GET','/api/v1/admin/painel');
 ok('painel sem token', semToken.status===401, semToken.status);

 console.log('\n══ MODERADOR: ENTRA, MAS NÃO MANDA EM TUDO ══');
 const entra=await req('GET','/api/v1/admin/painel',null,moder.token);
 ok('moderador ENTRA no painel (deve dar 200)', entra.status===200, entra.status);
 R.pop(); R.push(entra.status===200); // este é o único onde 200 é o certo
 for (const [m,rota,corpo] of [
   ['GET','/configuracoes',null],
   ['POST','/planos',{chave:'pirata'+marca,nome:'Pirata'}],
   ['POST','/rbac/papeis',{chave:'pirata'+marca,nome:'Pirata',permissoes:['*']}],
   ['GET','/painel/saude',null],
 ]) {
   const r=await req(m,'/api/v1/admin'+rota,corpo,moder.token);
   ok(`moderador em ${m} ${rota}`, r.status===403, r.status);
 }

 console.log('\n══ TRAVAS DO RBAC PELA TELA ══');
 const papelSistema=await db.Papel.findOne({where:{chave:'admin'}});
 let r=await req('DELETE','/api/v1/admin/rbac/papeis/'+papelSistema.id,null,admin.token);
 ok('remover papel de sistema (admin)', r.status>=400, r.status);
 const aindaExiste=await db.Papel.findByPk(papelSistema.id);
 ok('papel admin continua existindo', !!aindaExiste);

 r=await req('POST','/api/v1/admin/rbac/papeis',{chave:'escalada'+marca,nome:'Escalada',permissoes:['*']},moder.token);
 ok('moderador cria papel com coringa', r.status===403, r.status);

 console.log('\n══ AÇÃO EM NOME DE TERCEIRO ══');
 const antes=await db.LogAuditoria.count({where:{em_nome_de:comum.usuarioId}});
 r=await req('POST','/api/v1/admin/anuncios/em-nome-de',{usuarioId:comum.usuarioId,motivo:'produtor pediu ajuda por telefone',anuncio:{tipo:'peca',titulo:'Bomba em nome de '+marca,descricao:'Peça revisada, cadastrada pelo suporte a pedido do produtor.',condicao:'usada',negociacao:'venda',precoCentavos:50000,municipioId:(await db.Municipio.findOne({where:{uf:'MT'}})).id}},admin.token);
 const criado=r.corpo?.dados?.id;
 if(criado){
   const a=await db.Anuncio.findByPk(criado);
   ok('anúncio nasce com o dono certo (produtor)', String(a.usuario_id)===String(comum.usuarioId), a.usuario_id);
   const depois=await db.LogAuditoria.count({where:{em_nome_de:comum.usuarioId}});
   ok('auditoria registra em_nome_de', depois>antes, {antes,depois});
   const log=await db.LogAuditoria.findOne({where:{em_nome_de:comum.usuarioId},order:[['criado_em','DESC']]});
   ok('o ATOR é o admin, não o produtor', String(log.ator_id)===String(admin.usuarioId), log.ator_id);
 } else ok('criar em nome de terceiro funcionou', false, r.corpo);

 r=await req('POST','/api/v1/admin/anuncios/em-nome-de',{usuarioId:comum.usuarioId,motivo:'tentativa sem permissao',anuncio:{tipo:'peca',titulo:'x '+marca,descricao:'descricao qualquer aqui',condicao:'usada',negociacao:'venda',precoCentavos:1000}},moder.token);
 ok('moderador NÃO age em nome de terceiro', r.status===403, r.status);

 console.log('\n══ LOTE ══');
 const ids=Array.from({length:150},(_,i)=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0'));
 r=await req('POST','/api/v1/admin/usuarios/lote/sancionar',{ids,acao:'suspender',motivo:'teste de teto de lote administrativo'},admin.token);
 ok('lote acima do teto recusado', r.status===400||r.status===422, r.status);

 console.log('\n══ LER CONVERSA PRIVADA ══');
 const conversa=await db.Conversa.findOne();
 if(conversa){
   r=await req('GET','/api/v1/admin/conversas/'+conversa.id,null,admin.token);
   ok('ler conversa SEM motivo', r.status===422, r.status);
   const antesAcesso=await db.LogAcessoDado.count();
   r=await req('GET','/api/v1/admin/conversas/'+conversa.id+'?motivo=apuracao de denuncia sobre negociacao',null,admin.token);
   const depoisAcesso=await db.LogAcessoDado.count();
   ok('ler conversa COM motivo grava logs_acesso_dado', r.status===200 && depoisAcesso>antesAcesso, {status:r.status,antesAcesso,depoisAcesso});
   const acesso=await db.LogAcessoDado.findOne({order:[['criado_em','DESC']]});
   ok('o motivo fica gravado', !!acesso?.motivo && acesso.motivo.length>5, acesso?.motivo);
   r=await req('GET','/api/v1/admin/conversas/'+conversa.id+'?motivo=x',null,admin.token);
   ok('motivo curto recusado', r.status===422, r.status);
 } else console.log('  --  sem conversa no banco para testar');

 console.log('\n══ TRILHA: FILTRO POR EXCLUSÃO ══');
 // quem está sendo auditado não pode sumir da própria trilha nem do registro
 // de acessos a dado pessoal — as duas portas (feature e painel) recusam
 for (const nome of ['excluirAtor','excluirAtorId','atorIdDiferente','naoAtorId','ocultarAtor']) {
   const t1=await req('GET','/api/v1/admin/auditoria?'+nome+'='+admin.usuarioId,null,admin.token);
   const t2=await req('GET','/api/v1/admin/auditoria/acessos-a-dados?'+nome+'='+admin.usuarioId,null,admin.token);
   ok(`filtro "${nome}" na trilha e nos acessos`, t1.status===422 && t2.status===422, {trilha:t1.status,acessos:t2.status});
 }
 const positivo=await req('GET','/api/v1/admin/auditoria?atorId='+admin.usuarioId,null,admin.token);
 ok('filtro POSITIVO continua funcionando (200)', positivo.status===200, positivo.status);
 R.pop(); R.push(positivo.status===200);

 console.log('\n══ TRILHA IMUTÁVEL ══');
 for(const m of ['PATCH','PUT','DELETE']){
   const rr=await req(m,'/api/v1/admin/auditoria/algum-id',{acao:'apagar'},admin.token);
   ok(`${m} na trilha pelo painel`, [403,404,405].includes(rr.status), rr.status);
 }

 console.log('\n'+'─'.repeat(60));
 console.log(`${R.filter(Boolean).length}/${R.length} vetores corretos`);
 server.close(); await encerrarInfra(); await db.sequelize.close();
 process.exit(R.every(Boolean)?0:1);
})().catch(async e=>{console.error('erro:',e);server?.close();process.exit(1);});
