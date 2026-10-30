'use strict';

const { MercadoPagoConfig, Preference, Payment, PaymentRefund, WebhookSignatureValidator } = require('mercadopago');
const config = require('../../config');
const { AppError } = require('../../utils/erros');
const contas = require('./contas');

/**
 * Porta de pagamento — a única parte do sistema que conhece o Mercado Pago.
 *
 * As features falam em "criar cobrança", "consultar pagamento", "estornar";
 * quem traduz isso para Preference/Payment/PaymentRefund é este arquivo.
 * Trocar de gateway (ou ligar Split no futuro) é reescrever este módulo,
 * não a feature de pedido (Maturacao/03, §1.2).
 *
 * Os valores entram e saem em CENTAVOS. O MP trabalha em reais com casas
 * decimais; a conversão acontece só aqui, para que nenhuma conta de dinheiro
 * do sistema passe por float.
 */

/**
 * Conta ativa (a do painel, ou a do `.env` quando não há nenhuma no banco).
 * Sem nenhuma: 503 e não 500 — é configuração ausente, não bug, e o front
 * mostra "pagamento indisponível" em vez de "erro inesperado".
 */
async function exigirConta() {
  const conta = await contas.ativa();
  if (!conta) {
    throw new AppError(
      'Pagamento online indisponível no momento.',
      503,
      'PAGAMENTO_INDISPONIVEL'
    );
  }
  return conta;
}

const configurado = async () => Boolean(await contas.ativa());

const paraReais = (centavos) => Number(centavos) / 100;
const paraCentavos = (reais) => Math.round(Number(reais) * 100);

/**
 * Falha do gateway vira erro de contrato do projeto: o handler de erro só
 * traduz AppError, e um erro cru da SDK apareceria como 500 genérico.
 */
function traduzirFalha(erro, operacao) {
  console.error(`[pagamento] ${operacao} falhou:`, erro?.message, erro?.cause || '');
  return new AppError(
    'Não foi possível falar com o Mercado Pago. Tente novamente em instantes.',
    502,
    'PAGAMENTO_FALHOU'
  );
}

/** URL do webhook só se for alcançável: o MP recusa a preferência com localhost */
function urlNotificacao() {
  const url =
    config.pagamento.webhookUrl ||
    `${config.app.url}${config.app.apiPrefix}/v1/pagamentos/webhook`;
  return /^https:\/\//.test(url) ? url : undefined;
}

/**
 * Cria a cobrança no Checkout Pro.
 *
 * `external_reference` é o id do pedido — é ele, e não `metadata`, que volta
 * no pagamento e nas URLs de retorno, e é por ele que o webhook acha o
 * pedido. `metadata` leva o resto só para conciliação no painel do MP.
 *
 * Boleto e lotérica ficam de fora: compensam em até 3 dias úteis, e a peça
 * não pode ficar reservada esse tempo todo (ver `reservaMinutos`).
 *
 * @returns {{ preferenciaId, checkoutUrl }}
 */
async function criarCobranca({ pedido, comprador, expiraEm, idempotencia }) {
  const conta = await exigirConta();
  const preferencia = new Preference(contas.clienteDe(conta));
  const web = config.app.webUrl;

  try {
    const resposta = await preferencia.create({
      body: {
        items: [
          {
            id: pedido.anuncio_id,
            title: pedido.titulo,
            quantity: pedido.quantidade,
            unit_price: paraReais(pedido.preco_unitario_centavos),
            currency_id: 'BRL',
            category_id: 'others',
          },
        ],
        payer: { name: comprador.nome, email: comprador.email },
        external_reference: pedido.id,
        metadata: {
          pedido_id: pedido.id,
          comprador_id: pedido.comprador_id,
          vendedor_id: pedido.vendedor_id,
          comissao_centavos: Number(pedido.comissao_centavos),
          comissao_percentual: Number(pedido.comissao_percentual),
        },
        back_urls: {
          success: `${web}/checkout/sucesso?pedido=${pedido.id}`,
          failure: `${web}/checkout/erro?pedido=${pedido.id}`,
          pending: `${web}/checkout/pendente?pedido=${pedido.id}`,
        },
        /* `auto_return` exige back_url https — em dev o comprador clica em
           "voltar ao site" no próprio checkout */
        ...(/^https:\/\//.test(web) ? { auto_return: 'approved' } : {}),
        notification_url: urlNotificacao(),
        statement_descriptor: config.pagamento.descricaoFatura,
        payment_methods: {
          excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }],
          installments: 12,
        },
        expires: true,
        expiration_date_to: expiraEm.toISOString(),
      },
      requestOptions: { idempotencyKey: idempotencia },
    });

    return {
      /* a conta que criou a cobrança: consulta e estorno voltam nela */
      contaId: conta.id,
      preferenciaId: resposta.id,
      /* credencial de teste devolve o mesmo init_point; `sandbox_init_point`
         existe só por compatibilidade e o MP recomenda o principal */
      checkoutUrl: resposta.init_point,
    };
  } catch (erro) {
    throw traduzirFalha(erro, 'criarCobranca');
  }
}

/**
 * Consulta o pagamento na API — a ÚNICA fonte de verdade sobre status.
 * Nada que chega por webhook ou query string é aceito sem passar por aqui.
 */
async function consultarPagamento(pagamentoId, { contaId } = {}) {
  const candidatas = await emOrdemOuFalha({ contaId });

  for (const conta of candidatas) {
    try {
      const dados = await new Payment(contas.clienteDe(conta)).get({ id: String(pagamentoId) });
      return {
        id: String(dados.id),
        contaId: conta.id,
        status: dados.status,
        statusDetalhe: dados.status_detail || null,
        metodo: dados.payment_type_id || dados.payment_method_id || null,
        referencia: dados.external_reference || null,
        valorCentavos: paraCentavos(dados.transaction_amount),
        moeda: dados.currency_id,
        aprovadoEm: dados.date_approved ? new Date(dados.date_approved) : null,
      };
    } catch (erro) {
      /* o pagamento é de outra conta (ou ela perdeu o acesso): tenta a próxima */
      if ([401, 403, 404].includes(erro?.status)) continue;
      throw traduzirFalha(erro, 'consultarPagamento');
    }
  }
  return null;
}

async function emOrdemOuFalha(filtro) {
  const lista = await contas.emOrdemDeTentativa(filtro);
  if (!lista.length) {
    throw new AppError('Pagamento online indisponível no momento.', 503, 'PAGAMENTO_INDISPONIVEL');
  }
  return lista;
}

/** estorno total — o MP devolve ao meio de pagamento original */
async function estornar(pagamentoId, { idempotencia, contaId } = {}) {
  /* o estorno só funciona na conta que recebeu o dinheiro. Sem `contaId`
     (pedido anterior à troca de contas) usa a ativa, como sempre foi */
  const [conta] = await emOrdemOuFalha({ contaId });
  const reembolso = new PaymentRefund(contas.clienteDe(conta));
  try {
    const dados = await reembolso.create({
      payment_id: String(pagamentoId),
      body: {},
      requestOptions: idempotencia ? { idempotencyKey: idempotencia } : undefined,
    });
    return { id: String(dados.id), status: dados.status };
  } catch (erro) {
    throw traduzirFalha(erro, 'estornar');
  }
}

/**
 * Confere a assinatura `x-signature` do webhook (HMAC-SHA256 sobre
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`), com o validador
 * oficial da SDK — comparação em tempo constante.
 *
 * Sem segredo configurado: produção recusa; desenvolvimento aceita e avisa,
 * porque o pagamento é reconsultado na API de qualquer forma.
 *
 * @returns {boolean}
 */
async function assinaturaValida({ xSignature, xRequestId, dataId }) {
  /* o webhook não diz de qual conta veio: vale se bater com o segredo de
     qualquer uma — pagamento feito na conta antiga ainda notifica depois da troca */
  const segredos = (await contas.todas()).map((c) => c.webhookSecret).filter(Boolean);

  if (!segredos.length) {
    if (config.app.env === 'production') return false;
    console.warn('[pagamento] nenhum segredo de webhook configurado — webhook aceito sem assinatura (só fora de produção)');
    return true;
  }

  let motivo = null;
  for (const segredo of segredos) {
    try {
      WebhookSignatureValidator.validate({
        xSignature,
        xRequestId,
        /* o MP assina o id em minúsculas quando é alfanumérico */
        dataId: dataId ? String(dataId).toLowerCase() : dataId,
        secret: segredo,
        /* 5 min de tolerância corta replay sem brigar com relógio do servidor */
        toleranceSeconds: 300,
      });
      return true;
    } catch (erro) {
      motivo = erro.reason || erro.message;
    }
  }
  console.warn('[pagamento] webhook com assinatura inválida:', motivo, xRequestId || '');
  return false;
}

module.exports = {
  configurado,
  criarCobranca,
  consultarPagamento,
  estornar,
  assinaturaValida,
  invalidarContas: contas.invalidar,
  paraCentavos,
  paraReais,
};
