'use strict';

const limiteService = require('./plano.limite.service');
const usoService = require('./plano.uso.service');
const consultaService = require('./plano.consulta.service');
const { LIMITES, normalizarChave } = require('./plano.constants');

/**
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  SUPERFÍCIE PÚBLICA DO MÓDULO DE PLANO                                 │
 * │  É isto que os outros módulos importam. Nada mais.                     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ```js
 * const plano = require('../plano');
 *
 * const { permitido, limite, usado, restante } =
 *   await plano.podeUsar(ctx.usuarioId, plano.LIMITES.ANUNCIOS_ATIVOS);
 *
 * await plano.registrarUso(ctx.usuarioId, plano.LIMITES.ANUNCIOS_ATIVOS, 1, { transacao });
 * ```
 *
 * O barril existe — e é a única exceção do projeto ao "sem index de feature" —
 * porque este módulo tem CONSUMIDORES INTERNOS. Sem ele, `anuncio` e `midia`
 * importariam `plano.limite.service.js` pelo caminho do arquivo, e renomear
 * um service quebraria três módulos. O barril é o contrato; o arquivo por
 * trás é detalhe.
 *
 * Regra para quem consome: **verifique antes, registre depois**. `podeUsar` é
 * consulta e não reserva — entre a pergunta e a gravação cabe outra requisição
 * do mesmo usuário. Para o MVP gratuito isso é irrelevante (tudo é ilimitado);
 * quando houver plano pago, a reserva atômica entra aqui, não no chamador.
 */

module.exports = {
  /** { permitido, ilimitado, limite, usado, restante, chave, periodo, planoChave } */
  podeUsar: limiteService.podeUsar,

  /** grava consumo (negativo devolve a vaga); aceita { transacao } */
  registrarUso: limiteService.registrarUso,

  /** verifica e lança 403 padronizado se estourou */
  exigirLimite: limiteService.exigirLimite,

  /** todos os limites do usuário com o consumo de cada um */
  panorama: usoService.panorama,

  /** plano vigente + mapa de limites (sem assinatura → plano padrão) */
  planoEfetivo: consultaService.planoEfetivo,

  /** vocabulário de chaves — use a constante, não a string solta */
  LIMITES,
  normalizarChave,
};
