'use strict';

/**
 * Processo de worker — sobe SEPARADO da API (`npm run worker`).
 *
 * Separado porque job pesado (imagem, relatório, lote de e-mail) competiria
 * por CPU com quem está esperando uma tela carregar. Separado também escala
 * sozinho: em época de safra dá para subir três workers e uma API, ou o
 * contrário, sem tocar em código.
 */

const config = require('./src/config');
const redis = require('./src/providers/redis');
const filas = require('./src/filas');
const { sequelize } = require('./src/models');

/* rotinas periódicas — horários de madrugada, no fuso de Cuiabá */
const PERIODICOS = [
  { trabalho: 'manutencao.limparSessoes', cron: '0 3 * * *' },
  { trabalho: 'manutencao.limparTokens', cron: '15 3 * * *' },
  { trabalho: 'manutencao.desbloquearContas', cron: '*/10 * * * *' },
  /* a faxina de mídia roda depois da de sessões: as duas mexem em tabela
     grande, e concorrer por I/O de banco na mesma madrugada não ajuda ninguém */
  { trabalho: 'midia.limparOrfaos', cron: '30 3 * * *' },
  /* "peças mais procuradas hoje" precisa de dado do dia corrente, então a
     agregação NÃO é de madrugada: roda de hora em hora, aos 5 minutos, longe
     do topo da hora onde tudo o mais tende a se acumular */
  { trabalho: 'busca.agregarTermosPopulares', cron: '5 * * * *' },
  /* anúncio vencido continuar na vitrine é promessa falsa para quem clica;
     de hora em hora custa um index scan em `anuncios_expira_em` */
  { trabalho: 'anuncio.expirar', cron: '20 * * * *' },
];

async function iniciar() {
  if (!config.redis.url) {
    console.error('[worker] REDIS_URL não configurado. O worker existe para consumir fila — sem Redis não há fila.');
    process.exit(1);
  }

  redis.conectar();
  await new Promise((resolver) => setTimeout(resolver, 500));

  await sequelize.authenticate();
  console.log('[worker] banco conectado');

  const bullmq = require('./src/filas/adaptadores/bullmq');
  const total = bullmq.iniciarTrabalhadores();
  console.log(`[worker] ${total} fila(s) em consumo | motor: ${filas.motor()}`);

  for (const periodico of PERIODICOS) {
    await filas.agendar(periodico.trabalho, {}, { cron: periodico.cron });
    console.log(`[worker] agendado ${periodico.trabalho} (${periodico.cron})`);
  }

  /* encerramento limpo: sem isto, um deploy mata o processo no meio de um job
     e o trabalho fica preso como "ativo" até o BullMQ expirar o bloqueio */
  const encerrar = async (sinal) => {
    console.log(`\n[worker] ${sinal} recebido, finalizando jobs em andamento...`);
    await filas.encerrar();
    await redis.encerrar();
    await sequelize.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

if (require.main === module) {
  iniciar().catch((erro) => {
    console.error('[worker] falha ao iniciar:', erro);
    process.exit(1);
  });
}

module.exports = { iniciar };
