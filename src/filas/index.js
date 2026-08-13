'use strict';

const config = require('../config');
const redis = require('../providers/redis');
const definicoes = require('./definicoes');
const registro = require('./registro');
const imediato = require('./adaptadores/imediato');

/**
 * Filas do sistema.
 *
 * ```js
 * const filas = require('../../filas');
 * await filas.enfileirar('email.enviar', { para, modelo: 'boas_vindas', dados });
 * ```
 *
 * Quem chama não sabe se existe Redis, BullMQ ou nada disso — e é isso que
 * permite trocar o motor sem abrir uma feature.
 *
 * Os trabalhos são carregados aqui para que registrar um seja criar um arquivo
 * em `trabalhos/`, sem editar nenhum ponto central.
 */

require('./trabalhos/email.trabalho');
require('./trabalhos/manutencao.trabalho');
require('./trabalhos/relatorio.trabalho');
require('./trabalhos/busca.trabalho');
require('./trabalhos/lgpd.trabalho');
require('./trabalhos/auditoria.trabalho');
require('./trabalhos/anuncio.trabalho');
require('./trabalhos/notificacao.trabalho');
require('./trabalhos/midia.trabalho');

let bullmq = null;

function adaptador() {
  if (!redis.disponivel()) return imediato;

  /* carregado sob demanda: sem Redis, nem o módulo do BullMQ é lido */
  if (!bullmq) bullmq = require('./adaptadores/bullmq');
  return bullmq;
}

/**
 * @param opcoes.atrasoMs    executa depois de N ms
 * @param opcoes.chaveUnica  descarta duplicata com a mesma chave
 * @param opcoes.tentativas  sobrepõe o padrão da fila
 */
const enfileirar = (trabalho, dados = {}, opcoes = {}) =>
  adaptador().enfileirar(trabalho, dados, opcoes);

const agendar = (trabalho, dados, opcoes) => adaptador().agendar(trabalho, dados, opcoes);

const estatisticas = () => adaptador().estatisticas();

const encerrar = () => adaptador().encerrar();

const motor = () => adaptador().nome;

/**
 * Aviso de boot. Produção sem Redis funciona, mas perde retentativa,
 * persistência e agendamento — e isso precisa ser uma decisão consciente, não
 * uma descoberta no dia em que o provedor de e-mail cair.
 */
function conferirAmbiente() {
  if (config.app.env === 'production' && !config.redis.url) {
    console.warn(
      '[filas] ATENÇÃO: produção sem REDIS_URL. Jobs rodam no processo web, ' +
        'sem retentativa nem persistência. Configure Redis.'
    );
    return false;
  }
  return true;
}

module.exports = {
  enfileirar,
  agendar,
  estatisticas,
  encerrar,
  motor,
  conferirAmbiente,
  definicoes: definicoes.FILAS,
  registrar: registro.registrar,
  trabalhos: registro.listar,
};
