'use strict';

/**
 * Catálogo de filas.
 *
 * Uma fila por natureza de trabalho, não uma fila só para tudo: e-mail lento
 * não pode atrasar a geração de miniatura, e um job de relatório que trava não
 * pode segurar a notificação de mensagem nova.
 *
 * `concorrencia` é por instância de worker. Ajuste pelo gargalo real: e-mail
 * depende de provedor externo (pode ser alto), imagem depende de CPU (baixo).
 */

const FILAS = {
  EMAIL: {
    nome: 'email',
    concorrencia: 10,
    tentativas: 5,
    descricao: 'Envio de e-mail transacional',
  },

  NOTIFICACAO: {
    nome: 'notificacao',
    concorrencia: 10,
    tentativas: 3,
    descricao: 'Notificação no sistema e push',
  },

  MIDIA: {
    nome: 'midia',
    concorrencia: 3,
    tentativas: 2,
    descricao: 'Processamento de imagem de anúncio',
  },

  INDEXACAO: {
    nome: 'indexacao',
    concorrencia: 5,
    tentativas: 3,
    descricao: 'Recalcular texto de busca e contadores do anúncio',
  },

  /* fila própria: notificação do Mercado Pago não pode esperar atrás de
     lote de e-mail, e a consulta ao MP pode falhar e precisar de retentativa
     com espera longa (o MP às vezes notifica antes de o pagamento estar
     consultável) */
  PAGAMENTO: {
    nome: 'pagamento',
    concorrencia: 5,
    tentativas: 6,
    descricao: 'Notificações do Mercado Pago e rotinas de pedido',
  },

  MANUTENCAO: {
    nome: 'manutencao',
    concorrencia: 1,
    tentativas: 1,
    descricao: 'Rotinas periódicas: expirar anúncio, limpar sessão, LGPD',
  },
};

const LISTA = Object.values(FILAS);

const porNome = (nome) => LISTA.find((fila) => fila.nome === nome);

module.exports = { FILAS, LISTA, porNome };
