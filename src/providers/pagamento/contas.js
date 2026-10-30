'use strict';

const { MercadoPagoConfig } = require('mercadopago');
const db = require('../../models');
const config = require('../../config');
const { decifrar } = require('../../utils/cifra');

/**
 * De onde o provider tira as credenciais do Mercado Pago.
 *
 * A conta ATIVA no banco (escolhida pelo Admin no painel) manda. As variáveis
 * `MERCADOPAGO_*` do `.env` viram uma conta "de reserva", usada só quando o
 * banco não tem nenhuma ativa — assim o sistema continua funcionando antes do
 * primeiro cadastro e a troca para o painel é gradual.
 *
 * A lista fica em memória por pouco tempo: cada cobrança e cada webhook
 * passam por aqui, e ir ao banco a cada um seria desperdício. O TTL curto
 * cobre a API e o worker serem processos diferentes — o que o painel mudar
 * numa ponta chega na outra em segundos (a ponta que mudou invalida na hora).
 */

const TTL_MS = 30 * 1000;

let cache = null;
let carregadoEm = 0;
const clientes = new Map();

function daReserva() {
  if (!config.pagamento.accessToken) return null;
  return {
    id: null,
    apelido: 'Credenciais do servidor (.env)',
    accessToken: config.pagamento.accessToken,
    publicKey: config.pagamento.publicKey,
    webhookSecret: config.pagamento.webhookSecret,
    ativa: false,
    reserva: true,
  };
}

async function doBanco(linha) {
  return {
    id: linha.id,
    apelido: linha.apelido,
    accessToken: await decifrar(linha.access_token),
    publicKey: linha.public_key,
    webhookSecret: await decifrar(linha.webhook_secret),
    ativa: linha.ativa,
    reserva: false,
  };
}

async function todas() {
  if (cache && Date.now() - carregadoEm < TTL_MS) return cache;

  let linhas = [];
  try {
    linhas = await db.ContaMercadoPago.findAll({ order: [['criado_em', 'ASC']] });
  } catch (erro) {
    /* tabela ainda não migrada, ou banco fora: cai na reserva em vez de
       derrubar o checkout inteiro por causa de uma leitura de configuração */
    console.error('[pagamento] não consegui ler as contas do banco:', erro.message);
  }

  const lista = (await Promise.all(linhas.map(doBanco))).filter((c) => c.accessToken);
  const reserva = daReserva();
  if (reserva) lista.push(reserva);

  cache = lista;
  carregadoEm = Date.now();
  return cache;
}

/** a conta que recebe as cobranças NOVAS */
async function ativa() {
  const lista = await todas();
  return lista.find((c) => c.ativa) || lista.find((c) => c.reserva) || null;
}

/** contas na ordem em que vale tentar: a ativa primeiro, depois as demais */
async function emOrdemDeTentativa({ contaId } = {}) {
  const lista = await todas();
  if (contaId) return lista.filter((c) => c.id === contaId);
  const principal = await ativa();
  return principal ? [principal, ...lista.filter((c) => c !== principal)] : lista;
}

function clienteDe(conta) {
  if (!clientes.has(conta.accessToken)) {
    clientes.set(
      conta.accessToken,
      new MercadoPagoConfig({ accessToken: conta.accessToken, options: { timeout: 10000 } })
    );
  }
  return clientes.get(conta.accessToken);
}

function invalidar() {
  cache = null;
  carregadoEm = 0;
  clientes.clear();
}

module.exports = { todas, ativa, emOrdemDeTentativa, clienteDe, invalidar };
