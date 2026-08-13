'use strict';

const { registrar } = require('../registro');
const { FILAS } = require('../definicoes');
const email = require('../../providers/email');

/**
 * Envio de e-mail fora do caminho da requisição.
 *
 * Antes, o cadastro esperava o provedor responder para devolver a tela. Isso
 * amarrava o tempo de resposta a um sistema de terceiro e transformava uma
 * instabilidade do provedor em cadastro lento.
 *
 * O trabalho é idempotente do ponto de vista do usuário: reenviar o mesmo
 * código na retentativa é inofensivo, o que permite retentar com tranquilidade.
 */
const ENVIAR_EMAIL = registrar(
  'email.enviar',
  async ({ para, modelo, dados, assunto, texto }) => {
    const resultado = await email.enviar({ para, modelo, dados, assunto, texto });

    /* lançar faz o BullMQ retentar com espera exponencial; devolver "não
       entregue" em silêncio esconderia um provedor fora do ar */
    if (!resultado.entregue && !resultado.simulado) {
      throw new Error(`Provedor não entregou o e-mail para ${para}`);
    }
    return resultado;
  },
  { fila: FILAS.EMAIL.nome }
);

module.exports = { ENVIAR_EMAIL };
