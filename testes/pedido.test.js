'use strict';

/**
 * Compra com custódia, de ponta a ponta, contra a API e o banco de verdade.
 *
 *   node scripts/testar.js pedido
 *
 * O Mercado Pago é a ÚNICA peça substituída: o provider `providers/pagamento`
 * tem as três chamadas de rede trocadas por um gateway em memória (abaixo).
 * Todo o resto — rotas, RBAC, estoque, máquina de estados, webhook com
 * assinatura HMAC real, jobs — roda como em produção.
 *
 * O que esta suíte precisa provar, além do caminho feliz:
 *   · comissão e líquido fecham com o total, ao centavo;
 *   · a peça é reservada no checkout e não vende duas vezes;
 *   · webhook sem assinatura válida é recusado; repetido não duplica nada;
 *   · o valor pago tem que ser o do pedido;
 *   · só o comprador (ou a Admin) libera o repasse — nunca o vendedor;
 *   · disputa trava a liberação automática; 7 dias sem nada libera;
 *   · não se paga repasse retido; estorno cancela o repasse e devolve a peça.
 */

process.env.NODE_ENV = 'development';

const crypto = require('crypto');
const { RAIZ, cliente, criarUsuario, criarAnuncio, ok } = require('./apoio.cenario');
const { limparLimites, encerrarInfra } = require('./apoio');
const db = require(RAIZ + '/src/models');
const config = require(RAIZ + '/src/config');
const pagamento = require(RAIZ + '/src/providers/pagamento');
const acoes = require(RAIZ + '/src/features/pedido/pedido.acoes.service');
const { calcular } = require(RAIZ + '/src/features/pedido/pedido.calculo');

// ─── gateway em memória ───────────────────────────────────────────
const SEGREDO = 'segredo-de-teste-webhook';
config.pagamento.accessToken = 'TEST-token-da-suite';
config.pagamento.webhookSecret = SEGREDO;
config.pagamento.comissaoPercentual = 10;

const gateway = { pagamentos: new Map(), estornos: [], preferencias: 0, falharCobranca: false };
let proximoPagamento = 900000000 + Math.floor(Math.random() * 1000000);

pagamento.criarCobranca = async ({ pedido }) => {
  if (gateway.falharCobranca) {
    const { AppError } = require(RAIZ + '/src/utils/erros');
    throw new AppError('Não foi possível falar com o Mercado Pago.', 502, 'PAGAMENTO_FALHOU');
  }
  gateway.preferencias += 1;
  return { preferenciaId: `pref-${pedido.id}`, checkoutUrl: `https://mp.teste/checkout/${pedido.id}` };
};
pagamento.consultarPagamento = async (id) => gateway.pagamentos.get(String(id)) || null;
pagamento.estornar = async (id) => {
  gateway.estornos.push(String(id));
  const atual = gateway.pagamentos.get(String(id));
  if (atual) gateway.pagamentos.set(String(id), { ...atual, status: 'refunded' });
  return { id: `ref-${id}`, status: 'approved' };
};

/** o comprador "paga" no MP: o pagamento passa a existir na API */
function pagar(pedido, { status = 'approved', valorCentavos } = {}) {
  const id = String((proximoPagamento += 1));
  gateway.pagamentos.set(id, {
    id,
    status,
    statusDetalhe: status === 'approved' ? 'accredited' : 'pending_waiting_transfer',
    metodo: 'pix',
    referencia: pedido.id,
    valorCentavos: valorCentavos ?? pedido.valorTotalCentavos,
    moeda: 'BRL',
    aprovadoEm: status === 'approved' ? new Date() : null,
  });
  return id;
}

/** assina como o MP: HMAC-SHA256 de `id:..;request-id:..;ts:..;` */
function assinar(dataId, requestId, segredo = SEGREDO) {
  const ts = Math.floor(Date.now() / 1000);
  const hash = crypto.createHmac('sha256', segredo).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return `ts=${ts},v1=${hash}`;
}

let base;
async function webhook(pagamentoId, { segredo, semAssinatura } = {}) {
  const requestId = crypto.randomUUID();
  const r = await fetch(`${base}/pagamentos/webhook?data.id=${pagamentoId}&type=payment`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
      ...(semAssinatura ? {} : { 'x-signature': assinar(pagamentoId, requestId, segredo) }),
    },
    body: JSON.stringify({ type: 'payment', action: 'payment.updated', data: { id: String(pagamentoId) } }),
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

/** o webhook responde antes de processar (fila): espera o efeito aparecer */
async function aguardarStatus(pedidoId, esperado, tentativas = 40) {
  for (let i = 0; i < tentativas; i += 1) {
    const pedido = await db.Pedido.findByPk(pedidoId);
    if (pedido?.status === esperado) return pedido;
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
  return db.Pedido.findByPk(pedidoId);
}

async function tornarAdmin(conta) {
  const papel = await db.Papel.findOne({ where: { chave: 'admin' } });
  await db.UsuarioPapel.create({ usuario_id: conta.usuario.id, papel_id: papel.id });
  const loginService = require(RAIZ + '/src/features/auth/auth.login.service');
  const ctx = { ipHash: 'f'.repeat(64), userAgent: 'teste', origem: 'web' };
  const { tokens } = await loginService.entrar({ email: conta.email, senha: conta.senha }, ctx);
  return tokens.acesso;
}

let server;

(async () => {
  await limparLimites();

  /* com Redis, o webhook vai para o BullMQ — e aqui não há `worker.js`.
     Consome a fila de pagamento neste processo, como o `app.js` faz com o
     worker embutido; sem Redis o adaptador imediato já roda na hora */
  if (require(RAIZ + '/src/providers/redis').disponivel()) {
    require(RAIZ + '/src/filas/adaptadores/bullmq').iniciarTrabalhadores({ apenas: ['pagamento', 'notificacao'] });
  }

  const app = require(RAIZ + '/app');
  server = app.listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api/v1';
  const req = cliente(base);

  const marca = Date.now();
  const vendedor = await criarUsuario(`ped-vend-${marca}`);
  const comprador = await criarUsuario(`ped-comp-${marca}`);
  const outro = await criarUsuario(`ped-outro-${marca}`);
  const admin = await criarUsuario(`ped-adm-${marca}`);
  const tokenAdmin = await tornarAdmin(admin);

  const anuncio = await criarAnuncio(vendedor.usuario, vendedor.perfil, `ped-${marca}`);
  await anuncio.update({ quantidade: 2, preco_centavos: 12345 });

  console.log('\n— cálculo —');
  const conta = calcular({ precoUnitarioCentavos: 12345, quantidade: 1, percentual: 10 });
  ok('comissão de 10% arredonda ao centavo', conta.comissaoCentavos === 1235, conta);
  ok('comissão + líquido = total', conta.comissaoCentavos + conta.valorVendedorCentavos === conta.valorTotalCentavos, conta);
  const quebrado = calcular({ precoUnitarioCentavos: 999, quantidade: 3, percentual: 12.5 });
  ok('percentual quebrado também fecha', quebrado.comissaoCentavos + quebrado.valorVendedorCentavos === 2997, quebrado);

  console.log('\n— quem não pode comprar —');
  let r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio.id });
  ok('sem login → 401', r.status === 401, r.corpo);
  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio.id }, vendedor.token);
  ok('o próprio anúncio → 422', r.status === 422 && r.corpo?.erro?.detalhe?.motivo === 'proprio', r.corpo);

  const servico = await criarAnuncio(outro.usuario, outro.perfil, `ped-serv-${marca}`);
  await servico.update({ tipo: 'servico', negociacao: 'servico' });
  r = await req('POST', '/pedidos/checkout', { anuncioId: servico.id }, comprador.token);
  ok('serviço não entra no checkout → 422', r.status === 422 && r.corpo?.erro?.detalhe?.motivo === 'tipo', r.corpo);

  const combinar = await criarAnuncio(outro.usuario, outro.perfil, `ped-comb-${marca}`);
  await combinar.update({ preco_centavos: null, preco_a_combinar: true });
  r = await req('POST', '/pedidos/checkout', { anuncioId: combinar.id }, comprador.token);
  ok('preço a combinar → 422', r.status === 422 && r.corpo?.erro?.detalhe?.motivo === 'preco', r.corpo);

  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio.id, quantidade: 3 }, comprador.token);
  ok('mais do que o estoque → 409', r.status === 409 && r.corpo?.erro?.codigo === 'ESTOQUE_INSUFICIENTE', r.corpo);

  config.pagamento.accessToken = null;
  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio.id }, comprador.token);
  ok('sem credencial do MP → 503, sem reservar', r.status === 503, r.corpo);
  config.pagamento.accessToken = 'TEST-token-da-suite';
  await anuncio.reload();
  ok('estoque intacto depois do 503', anuncio.quantidade === 2, anuncio.quantidade);

  console.log('\n— falha no MP desfaz a reserva —');
  gateway.falharCobranca = true;
  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio.id }, comprador.token);
  gateway.falharCobranca = false;
  ok('MP fora do ar → 502', r.status === 502, r.corpo);
  await anuncio.reload();
  ok('a peça voltou ao estoque', anuncio.quantidade === 2, anuncio.quantidade);
  const desfeito = await db.Pedido.findOne({ where: { comprador_id: comprador.usuario.id }, order: [['criado_em', 'DESC']] });
  ok('o pedido ficou cancelado, com histórico', desfeito?.status === 'cancelado', desfeito?.status);

  console.log('\n— checkout —');
  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio.id }, comprador.token);
  ok('cria pedido → 201 com link do MP', r.status === 201 && r.corpo?.dados?.checkoutUrl?.startsWith('https://mp.teste/'), r.corpo);
  const pedido = r.corpo.dados.pedido;
  ok('valores congelados no pedido', pedido.valorTotalCentavos === 12345 && pedido.status === 'aguardando_pagamento', pedido);
  ok('comprador não vê a comissão', pedido.comissaoCentavos === undefined && pedido.valorVendedorCentavos === undefined, pedido);
  await anuncio.reload();
  ok('estoque reservado (2 → 1)', anuncio.quantidade === 1, anuncio.quantidade);

  const preferenciasAntes = gateway.preferencias;
  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio.id }, comprador.token);
  ok('duplo clique → 200, mesmo pedido', r.status === 200 && r.corpo.dados.pedido.id === pedido.id && r.corpo.dados.reaproveitado, r.corpo);
  await anuncio.reload();
  ok('sem segunda reserva nem segunda preferência', anuncio.quantidade === 1 && gateway.preferencias === preferenciasAntes, { q: anuncio.quantidade });

  console.log('\n— webhook —');
  const pagamentoId = pagar(pedido);

  r = await webhook(pagamentoId, { semAssinatura: true });
  ok('sem x-signature → 401', r.status === 401, r.corpo);
  r = await webhook(pagamentoId, { segredo: 'outro-segredo' });
  ok('assinatura com segredo errado → 401', r.status === 401, r.corpo);
  ok('pedido continua aguardando', (await db.Pedido.findByPk(pedido.id)).status === 'aguardando_pagamento');

  r = await webhook(pagamentoId);
  ok('assinatura válida → 200', r.status === 200 && r.corpo?.dados?.recebido, r.corpo);
  let noBanco = await aguardarStatus(pedido.id, 'pago');
  ok('pagamento aprovado → pedido pago', noBanco.status === 'pago' && noBanco.mp_pagamento_id === pagamentoId, noBanco.status);
  ok('liberação automática agendada (~7 dias)', Math.round((noBanco.liberacao_automatica_em - Date.now()) / 86400000) === 7, noBanco.liberacao_automatica_em);

  let repasse = await db.Repasse.findOne({ where: { pedido_id: pedido.id } });
  ok('repasse retido no valor líquido', repasse?.status === 'retido' && Number(repasse.valor_centavos) === 12345 - 1235, repasse?.toJSON());

  await webhook(pagamentoId);
  await webhook(pagamentoId);
  await new Promise((resolver) => setTimeout(resolver, 300));
  ok('webhook repetido não duplica repasse', (await db.Repasse.count({ where: { pedido_id: pedido.id } })) === 1);
  ok('nem histórico de "pago"', (await db.PedidoHistorico.count({ where: { pedido_id: pedido.id, status_novo: 'pago' } })) === 1);

  r = await webhook('123', {});
  ok('pagamento desconhecido → 200 e ignora', r.status === 200, r.corpo);

  console.log('\n— leituras —');
  r = await req('GET', '/pedidos/compras', null, comprador.token);
  ok('aparece em "minhas compras"', r.status === 200 && r.corpo.dados.some((p) => p.id === pedido.id), r.corpo);
  r = await req('GET', '/pedidos/vendas', null, vendedor.token);
  const venda = r.corpo?.dados?.find((p) => p.id === pedido.id);
  ok('vendedor vê comissão e líquido', venda?.comissaoCentavos === 1235 && venda?.valorVendedorCentavos === 11110, venda);
  ok('vendedor não vê a chave PIX do repasse', venda && venda.repasse && venda.repasse.chavePix === undefined, venda?.repasse);
  r = await req('GET', '/pedidos/' + pedido.id, null, outro.token);
  ok('terceiro não vê o pedido → 404', r.status === 404, r.corpo);

  console.log('\n— custódia —');
  r = await req('POST', '/pedidos/' + pedido.id + '/confirmar-recebimento', {}, vendedor.token);
  ok('vendedor NÃO libera o próprio saldo', r.status === 404 || r.status === 403, r.corpo);

  r = await req('GET', '/admin/repasses?status=retido&vendedorId=' + vendedor.usuario.id, null, tokenAdmin);
  const linhaRetida = r.corpo?.dados?.find((item) => item.pedido?.id === pedido.id);
  ok('Admin vê o repasse retido', r.status === 200 && Boolean(linhaRetida), r.corpo);
  r = await req('POST', '/admin/repasses/' + linhaRetida.id + '/pagar', {}, tokenAdmin);
  ok('não paga repasse ainda retido → 409', r.status === 409, r.corpo);

  r = await req('POST', '/pedidos/' + pedido.id + '/confirmar-recebimento', {}, comprador.token);
  ok('comprador confirma → entregue', r.status === 200 && r.corpo.dados.status === 'entregue', r.corpo);
  repasse = await repasse.reload();
  ok('repasse disponível', repasse.status === 'disponivel' && repasse.disponivel_em, repasse.status);

  r = await req('POST', '/admin/repasses/' + repasse.id + '/pagar', {}, tokenAdmin);
  ok('sem chave PIX do vendedor → 409', r.status === 409, r.corpo);

  r = await req('PUT', '/repasses/chave-pix', { chavePixTipo: 'cpf', chavePix: '123' }, vendedor.token);
  ok('chave que não bate com o tipo → 422', r.status === 422, r.corpo);
  r = await req('PUT', '/repasses/chave-pix', { chavePixTipo: 'cpf', chavePix: '529.982.247-25' }, vendedor.token);
  ok('chave PIX salva normalizada', r.status === 200 && r.corpo.dados.chavePix === '52998224725', r.corpo);

  r = await req('GET', '/repasses', null, vendedor.token);
  ok('extrato mostra disponível', r.status === 200 && r.corpo.meta.resumo.totais.disponivel >= 11110, r.corpo?.meta);

  r = await req('POST', '/admin/repasses/' + repasse.id + '/pagar', { comprovante: 'E2E-123' }, tokenAdmin);
  ok('Admin registra o PIX', r.status === 200 && r.corpo.dados.status === 'pago', r.corpo);
  noBanco = await db.Pedido.findByPk(pedido.id);
  repasse = await repasse.reload();
  ok('pedido concluído e chave copiada', noBanco.status === 'concluido' && repasse.chave_pix === '52998224725', { s: noBanco.status });
  r = await req('POST', '/admin/repasses/' + repasse.id + '/pagar', {}, tokenAdmin);
  ok('pagar de novo → 409', r.status === 409, r.corpo);

  console.log('\n— visão da Admin —');
  r = await req('GET', '/admin/vendas', null, tokenAdmin);
  ok('lista vendas com resumo financeiro', r.status === 200 && r.corpo.meta.resumo.comissaoCentavos >= 1235, r.corpo?.meta);
  r = await req('GET', '/admin/vendas', null, comprador.token);
  ok('usuário comum fora do financeiro → 403', r.status === 403, r.corpo);

  console.log('\n— disputa e liberação automática —');
  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio.id }, outro.token);
  const pedido2 = r.corpo.dados.pedido;
  await webhook(pagar(pedido2));
  await aguardarStatus(pedido2.id, 'pago');
  await anuncio.reload();
  ok('última unidade vendida (estoque 0)', anuncio.quantidade === 0, anuncio.quantidade);
  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio.id }, comprador.token);
  ok('esgotado → 409', r.status === 409, r.corpo);

  r = await req('POST', '/pedidos/' + pedido2.id + '/disputa', { motivo: 'curto' }, outro.token);
  ok('disputa exige descrição → 422', r.status === 422, r.corpo);
  r = await req('POST', '/pedidos/' + pedido2.id + '/disputa', { motivo: 'A peça chegou quebrada na embalagem.' }, outro.token);
  ok('comprador abre disputa', r.status === 200 && r.corpo.dados.status === 'em_disputa', r.corpo);

  await db.Pedido.update({ liberacao_automatica_em: new Date(Date.now() - 1000) }, { where: { id: pedido2.id } });
  await acoes.liberarAutomaticamente();
  ok('disputa não libera sozinha', (await db.Pedido.findByPk(pedido2.id)).status === 'em_disputa');
  r = await req('POST', '/pedidos/' + pedido2.id + '/confirmar-recebimento', {}, outro.token);
  ok('comprador não encerra a disputa sozinho → 409', r.status === 409, r.corpo);

  console.log('\n— estorno pela Admin —');
  r = await req('POST', '/admin/vendas/' + pedido2.id + '/reembolsar', { motivo: 'Peça avariada no transporte.' }, tokenAdmin);
  ok('estorno → reembolsado', r.status === 200 && r.corpo.dados.status === 'reembolsado', r.corpo);
  ok('o MP recebeu o pedido de estorno', gateway.estornos.length === 1, gateway.estornos);
  const repasse2 = await db.Repasse.findOne({ where: { pedido_id: pedido2.id } });
  ok('repasse cancelado', repasse2.status === 'cancelado', repasse2.status);
  await anuncio.reload();
  ok('peça voltou ao estoque', anuncio.quantidade === 1, anuncio.quantidade);

  console.log('\n— liberação automática em 7 dias —');
  /* a cota de checkout por pessoa já foi provada; o resto da suíte não é sobre ela */
  await limparLimites();
  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio.id }, comprador.token);
  const pedido3 = r.corpo.dados.pedido;

  r = await req('POST', '/pedidos/' + pedido3.id + '/sincronizar', { pagamentoId: pagar(pedido3, { valorCentavos: 100 }) }, comprador.token);
  ok('valor pago diferente do pedido NÃO paga', r.status === 200 && r.corpo.dados.status === 'aguardando_pagamento', r.corpo?.dados?.status);

  r = await req('POST', '/pedidos/' + pedido3.id + '/sincronizar', { pagamentoId: pagar(pedido3) }, comprador.token);
  ok('volta do checkout sincroniza sem webhook', r.status === 200 && r.corpo.dados.status === 'pago', r.corpo?.dados?.status);
  r = await req('POST', '/pedidos/' + pedido3.id + '/sincronizar', { pagamentoId: pagamentoId }, comprador.token);
  ok('pagamento de outro pedido → 400', r.status === 400, r.corpo);

  await db.Pedido.update({ liberacao_automatica_em: new Date(Date.now() - 1000) }, { where: { id: pedido3.id } });
  const liberacao = await acoes.liberarAutomaticamente();
  noBanco = await db.Pedido.findByPk(pedido3.id);
  ok('sem confirmação nem disputa → libera', liberacao.liberados >= 1 && noBanco.status === 'entregue' && noBanco.entrega_confirmada_por === 'sistema', noBanco.status);
  ok('repasse disponível', (await db.Repasse.findOne({ where: { pedido_id: pedido3.id } })).status === 'disponivel');

  console.log('\n— reserva vencida —');
  const anuncio2 = await criarAnuncio(vendedor.usuario, vendedor.perfil, `ped2-${marca}`);
  await anuncio2.update({ quantidade: 1 });
  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio2.id }, comprador.token);
  const pedido4 = r.corpo.dados.pedido;
  await db.Pedido.update({ reservado_ate: new Date(Date.now() - 1000) }, { where: { id: pedido4.id } });
  await acoes.expirarReservas();
  await anuncio2.reload();
  ok('reserva vencida → cancelado e estoque de volta', (await db.Pedido.findByPk(pedido4.id)).status === 'cancelado' && anuncio2.quantidade === 1, anuncio2.quantidade);

  const tardio = pagar(pedido4);
  await webhook(tardio);
  ok('Pix pago depois do prazo, com estoque → pedido revive', (await aguardarStatus(pedido4.id, 'pago')).status === 'pago');

  const anuncio3 = await criarAnuncio(vendedor.usuario, vendedor.perfil, `ped3-${marca}`);
  await anuncio3.update({ quantidade: 1 });
  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio3.id }, comprador.token);
  const pedido5 = r.corpo.dados.pedido;
  await db.Pedido.update({ reservado_ate: new Date(Date.now() - 1000) }, { where: { id: pedido5.id } });
  await acoes.expirarReservas();
  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio3.id }, outro.token);
  await webhook(pagar(r.corpo.dados.pedido));
  await aguardarStatus(r.corpo.dados.pedido.id, 'pago');
  const estornosAntes = gateway.estornos.length;
  const pagoTarde = pagar(pedido5);
  await webhook(pagoTarde);
  await new Promise((resolver) => setTimeout(resolver, 300));
  ok('Pix pago depois do prazo, peça já vendida → estorno automático', gateway.estornos.length === estornosAntes + 1 && gateway.estornos.includes(pagoTarde), gateway.estornos);
  await webhook(pagoTarde);
  ok('o webhook de "refunded" fecha o pedido', (await aguardarStatus(pedido5.id, 'reembolsado')).status === 'reembolsado');

  r = await req('POST', '/pedidos/checkout', { anuncioId: anuncio2.id }, outro.token);
  ok('peça vendida no revive não vende de novo → 409', r.status === 409, r.corpo);

  server.close();
  await db.sequelize.close();
  await encerrarInfra();
})().catch((e) => {
  console.error('\nERRO NO TESTE:', e);
  server?.close();
  process.exit(1);
});
