'use strict';

const db = require('../../../models');
const config = require('../../../config');
const { erros } = require('../../../utils/erros');
const { cifrar, decifrar, mascarar } = require('../../../utils/cifra');
const pagamento = require('../../../providers/pagamento');
const { registrarAcao } = require('../helpers/admin.auditoria.helper');

/**
 * Contas do Mercado Pago que a plataforma pode usar para receber.
 *
 * A cliente migra de conta pessoa física para CNPJ: o painel guarda quantas
 * contas ela quiser e deixa UMA ativa. Trocar a ativa só afeta cobranças
 * NOVAS — pedido já criado continua sendo consultado e estornado na conta
 * que o recebeu (`pedidos.conta_mp_id`).
 *
 * Token e segredo nunca saem daqui em claro: a API devolve só a versão
 * mascarada. Toda mudança passa por auditoria, sem os valores.
 */

const API_MP = 'https://api.mercadopago.com';

/** pedidos nestes estados ainda dependem da conta para consulta/estorno */
const STATUS_EM_ABERTO = ['aguardando_pagamento', 'pago', 'em_disputa', 'entregue'];

function webhookUrl() {
  return config.pagamento.webhookUrl || `${config.app.url}${config.app.apiPrefix}/v1/pagamentos/webhook`;
}

async function paraDto(conta) {
  return {
    id: conta.id,
    apelido: conta.apelido,
    tipoPessoa: conta.tipo_pessoa,
    modo: conta.modo,
    ativa: conta.ativa,
    accessTokenMascarado: mascarar(await decifrar(conta.access_token)),
    publicKey: conta.public_key,
    temWebhookSecret: Boolean(conta.webhook_secret),
    mpUserId: conta.mp_user_id,
    mpEmail: conta.mp_email,
    mpNickname: conta.mp_nickname,
    verificadaEm: conta.verificada_em,
    ativadaEm: conta.ativada_em,
    criadoEm: conta.criado_em,
  };
}

/**
 * Pergunta ao MP "de quem é esse token?". É a prova de que a credencial
 * funciona — melhor descobrir ao cadastrar do que no checkout do cliente.
 */
async function consultarDono(accessToken) {
  let resposta;
  try {
    resposta = await fetch(`${API_MP}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw erros.invalido('Não consegui falar com o Mercado Pago para conferir o Access Token. Tente de novo.');
  }
  if (resposta.status === 401 || resposta.status === 403) {
    throw erros.invalido('O Mercado Pago recusou este Access Token. Confira se copiou inteiro, sem espaços.');
  }
  if (!resposta.ok) {
    throw erros.invalido(`O Mercado Pago respondeu com erro (${resposta.status}) ao conferir o Access Token.`);
  }
  const dados = await resposta.json();
  return {
    mp_user_id: dados.id != null ? String(dados.id) : null,
    mp_email: dados.email || null,
    mp_nickname: dados.nickname || null,
  };
}

async function buscar(id) {
  const conta = await db.ContaMercadoPago.findByPk(id);
  if (!conta) throw erros.naoEncontrado('Conta do Mercado Pago');
  return conta;
}

const aposMudar = () => pagamento.invalidarContas();

async function listar() {
  const contas = await db.ContaMercadoPago.findAll({ order: [['ativa', 'DESC'], ['criado_em', 'ASC']] });
  return {
    itens: await Promise.all(contas.map(paraDto)),
    webhookUrl: webhookUrl(),
    /* credenciais do .env: valem enquanto nenhuma conta do painel estiver ativa */
    reservaDoServidor: Boolean(config.pagamento.accessToken),
    usandoReserva: Boolean(config.pagamento.accessToken) && !contas.some((c) => c.ativa),
  };
}

async function criar(contexto, dados) {
  const dono = await consultarDono(dados.accessToken);

  const primeira = (await db.ContaMercadoPago.count()) === 0;
  const conta = await db.ContaMercadoPago.create({
    apelido: dados.apelido,
    tipo_pessoa: dados.tipoPessoa,
    modo: dados.modo,
    access_token: await cifrar(dados.accessToken),
    public_key: dados.publicKey || null,
    webhook_secret: await cifrar(dados.webhookSecret),
    ...dono,
    verificada_em: new Date(),
  });

  await registrarAcao(contexto, {
    acao: 'criar',
    entidade: 'contas_mercadopago',
    entidadeId: conta.id,
    depois: { apelido: conta.apelido, tipoPessoa: conta.tipo_pessoa, modo: conta.modo, mpUserId: conta.mp_user_id },
  });
  aposMudar();

  /* a primeira conta cadastrada já nasce ativa: não faz sentido ter só uma e ela parada */
  if (primeira || dados.ativar) return ativar(contexto, conta.id);
  return paraDto(conta);
}

async function editar(contexto, id, dados) {
  const conta = await buscar(id);
  const antes = { apelido: conta.apelido, tipoPessoa: conta.tipo_pessoa, modo: conta.modo };

  if (dados.apelido !== undefined) conta.apelido = dados.apelido;
  if (dados.tipoPessoa !== undefined) conta.tipo_pessoa = dados.tipoPessoa;
  if (dados.modo !== undefined) conta.modo = dados.modo;
  if (dados.publicKey !== undefined) conta.public_key = dados.publicKey || null;
  if (dados.webhookSecret) conta.webhook_secret = await cifrar(dados.webhookSecret);
  if (dados.accessToken) {
    Object.assign(conta, await consultarDono(dados.accessToken), { verificada_em: new Date() });
    conta.access_token = await cifrar(dados.accessToken);
  }
  await conta.save();

  await registrarAcao(contexto, {
    acao: 'editar',
    entidade: 'contas_mercadopago',
    entidadeId: conta.id,
    antes,
    depois: {
      apelido: conta.apelido,
      tipoPessoa: conta.tipo_pessoa,
      modo: conta.modo,
      trocouToken: Boolean(dados.accessToken),
      trocouSegredo: Boolean(dados.webhookSecret),
    },
  });
  aposMudar();
  return paraDto(conta);
}

/** reconfere o token agora e devolve quem é o dono — o botão "Testar conexão" */
async function testar(contexto, id) {
  const conta = await buscar(id);
  const token = await decifrar(conta.access_token);
  if (!token) throw erros.conflito('Não foi possível ler o token desta conta. Cadastre-o de novo.');
  Object.assign(conta, await consultarDono(token), { verificada_em: new Date() });
  await conta.save();
  return paraDto(conta);
}

async function ativar(contexto, id) {
  const conta = await buscar(id);
  const token = await decifrar(conta.access_token);
  if (!token) throw erros.conflito('Não foi possível ler o token desta conta. Cadastre-o de novo.');

  /* confere antes de ativar: ativar conta com token vencido derrubaria o checkout */
  Object.assign(conta, await consultarDono(token), { verificada_em: new Date() });

  const anterior = await db.ContaMercadoPago.findOne({ where: { ativa: true } });
  await db.sequelize.transaction(async (transaction) => {
    /* desliga antes de ligar: o índice parcial só aceita uma ativa por vez */
    await db.ContaMercadoPago.update({ ativa: false }, { where: { ativa: true }, transaction });
    conta.ativa = true;
    conta.ativada_em = new Date();
    await conta.save({ transaction });
  });

  await registrarAcao(contexto, {
    acao: 'editar',
    entidade: 'contas_mercadopago',
    entidadeId: conta.id,
    antes: { contaAtivaId: anterior?.id || null },
    depois: { contaAtivaId: conta.id, apelido: conta.apelido },
    motivo: 'troca da conta que recebe os pagamentos',
  });
  aposMudar();
  return paraDto(conta);
}

async function remover(contexto, id) {
  const conta = await buscar(id);
  if (conta.ativa) {
    throw erros.conflito('Esta é a conta ativa. Ative outra antes de removê-la.');
  }
  const emAberto = await db.Pedido.count({ where: { conta_mp_id: id, status: STATUS_EM_ABERTO } });
  if (emAberto > 0) {
    throw erros.conflito(
      `Há ${emAberto} pedido(s) em andamento nesta conta. Ela precisa continuar cadastrada para consultar e estornar esses pagamentos.`
    );
  }

  await conta.destroy();
  await registrarAcao(contexto, {
    acao: 'remover',
    entidade: 'contas_mercadopago',
    entidadeId: id,
    antes: { apelido: conta.apelido, mpUserId: conta.mp_user_id },
  });
  aposMudar();
}

module.exports = { listar, criar, editar, testar, ativar, remover };
