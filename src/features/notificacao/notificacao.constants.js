'use strict';

const { NOTIFICACAO_CANAL, NOTIFICACAO_TIPO } = require('../../models/constantes');

/**
 * Vocabulário fechado da feature. Fica fora dos services para que ninguém
 * precise caçar a mesma string em cinco arquivos quando uma regra mudar.
 */

/**
 * Canais que este módulo REALMENTE entrega hoje.
 *
 * O enum do banco (`NOTIFICACAO_CANAL`) também tem `whatsapp` e `push`, porque
 * o schema foi desenhado para o produto inteiro. Aceitar no contrato um canal
 * sem provider por trás criaria linha "enviada" que nunca sai — pior que
 * recusar, porque some do radar. Ver pendências em `documentacao/features/Notificacao.md`.
 */
const CANAIS_ENTREGUES = ['sistema', 'email'];

/** todos os canais que a tela de preferências deixa o usuário configurar */
const CANAIS_CONFIGURAVEIS = NOTIFICACAO_CANAL;

/**
 * Tipos que o usuário NÃO pode desligar.
 *
 * São avisos ligados à segurança e ao estado da própria conta: desligar
 * "conta suspensa" faria a pessoa descobrir a suspensão pelo silêncio. LGPD
 * não exige opt-in aqui — é execução de contrato, não marketing.
 * A preferência continua existindo no banco; o que ignoramos é o `ativo=false`
 * para o canal `sistema`, que é o registro dentro da plataforma.
 */
const TIPOS_NAO_SILENCIAVEIS = ['conta_suspensa'];

/** tipo usado pelo comunicado do Admin — o enum não tem "comunicado" */
const TIPO_COMUNICADO = 'sistema';

/** `referencia_tipo` de um envio em massa: guarda o id do lote, não de uma entidade */
const ENTIDADE_COMUNICADO = 'comunicados';

/**
 * Tamanho do bloco de `bulkCreate` no envio em massa.
 *
 * 500 é o meio-termo entre round-trips ao Postgres e um INSERT com parâmetros
 * demais (o driver tem teto de 65535 bind params; 500 linhas × ~11 colunas
 * fica confortavelmente abaixo). Cada bloco é um job, então uma falha retenta
 * só o bloco, nunca o comunicado inteiro.
 */
const LOTE_TAMANHO = 500;

/** teto de itens por página na listagem — `?porPagina=100000` é DoS de graça */
const LISTA_MAXIMO = 50;

/** teto de ids num "marcar como lida" em lote */
const MARCAR_LOTE_MAXIMO = 200;

/**
 * TTL do contador de não lidas.
 *
 * O valor certo é gravado e invalidado em toda escrita, então o TTL é só rede
 * de segurança para um processo que morreu no meio de uma invalidação —
 * 5 minutos de contador levemente errado é aceitável, contador errado para
 * sempre não é.
 */
const CONTADOR_TTL_SEGUNDOS = 300;

/**
 * Teto do contador exibido.
 *
 * Ninguém lê "1.284 não lidas": o front mostra "99+". Contar até 100 e parar
 * transforma um COUNT que varre tudo num COUNT com LIMIT.
 */
const CONTADOR_TETO = 100;

module.exports = {
  CANAIS_ENTREGUES,
  CANAIS_CONFIGURAVEIS,
  TIPOS_NAO_SILENCIAVEIS,
  TIPO_COMUNICADO,
  ENTIDADE_COMUNICADO,
  LOTE_TAMANHO,
  LISTA_MAXIMO,
  MARCAR_LOTE_MAXIMO,
  CONTADOR_TTL_SEGUNDOS,
  CONTADOR_TETO,
  TIPOS: NOTIFICACAO_TIPO,
};
