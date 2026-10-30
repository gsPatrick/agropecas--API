'use strict';

const filas = require('../../filas');

/**
 * Avisos do fluxo de compra — no sino do sistema.
 *
 * Tipo `sistema` com `dados.evento`: o fluxo é novo e o texto ainda vai
 * mudar com o uso; tipo próprio por evento exigiria migração de enum a cada
 * ajuste de produto. Falha ao avisar nunca desfaz o pedido — por isso fila,
 * e por isso o `catch`.
 */

const reais = (centavos) =>
  (Number(centavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function avisar(usuarioId, pedido, evento, titulo, mensagem) {
  try {
    await filas.enfileirar('notificacao.criar', {
      usuarioId,
      tipo: 'sistema',
      titulo,
      mensagem,
      dados: { evento, pedidoId: pedido.id, codigo: pedido.codigo },
      entidade: 'pedidos',
      entidadeId: pedido.id,
      canais: ['sistema'],
    });
  } catch (erro) {
    console.error('[pedido] falha ao avisar', evento, erro.message);
  }
}

const pago = async (pedido) => {
  await avisar(
    pedido.vendedor_id,
    pedido,
    'venda_paga',
    'Você vendeu uma peça!',
    `Pedido ${pedido.codigo}: "${pedido.titulo}" foi pago. Combine a entrega com o comprador. ` +
      `Seu saldo de ${reais(pedido.valor_vendedor_centavos)} fica retido até o recebimento ser confirmado.`
  );
  await avisar(
    pedido.comprador_id,
    pedido,
    'compra_paga',
    'Pagamento aprovado',
    `Pedido ${pedido.codigo}: pagamento confirmado. Quando a peça chegar, confirme o recebimento em "Minhas compras".`
  );
};

const entregue = (pedido) =>
  avisar(
    pedido.vendedor_id,
    pedido,
    'repasse_disponivel',
    'Saldo liberado para repasse',
    `Pedido ${pedido.codigo}: o recebimento foi confirmado e ${reais(pedido.valor_vendedor_centavos)} ` +
      'estão disponíveis. O PIX é feito pela AgroPeças na chave cadastrada no seu painel.'
  );

const repassePago = (pedido, repasse) =>
  avisar(
    pedido.vendedor_id,
    pedido,
    'repasse_pago',
    'Repasse enviado',
    `Pedido ${pedido.codigo}: enviamos ${reais(repasse.valor_centavos)} por PIX.`
  );

const disputa = (pedido) =>
  avisar(
    pedido.vendedor_id,
    pedido,
    'disputa_aberta',
    'O comprador abriu uma disputa',
    `Pedido ${pedido.codigo}: o comprador relatou um problema com a entrega. A equipe AgroPeças vai entrar em contato.`
  );

const reembolsado = async (pedido) => {
  await avisar(
    pedido.comprador_id,
    pedido,
    'compra_reembolsada',
    'Pagamento estornado',
    `Pedido ${pedido.codigo}: o valor de ${reais(pedido.valor_total_centavos)} foi estornado ao seu meio de pagamento.`
  );
  await avisar(
    pedido.vendedor_id,
    pedido,
    'venda_reembolsada',
    'Venda estornada',
    `Pedido ${pedido.codigo}: o pagamento foi estornado ao comprador e o repasse cancelado.`
  );
};

module.exports = { pago, entregue, repassePago, disputa, reembolsado };
