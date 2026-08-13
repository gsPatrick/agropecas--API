'use strict';

const db = require('../../models');
const cache = require('../../cache');
const { chaves } = require('./notificacao.cache');
const {
  CANAIS_CONFIGURAVEIS,
  TIPOS,
  TIPOS_NAO_SILENCIAVEIS,
  CONTADOR_TTL_SEGUNDOS,
} = require('./notificacao.constants');

/**
 * Preferências de notificação — o que cada pessoa aceita receber, por tipo e
 * canal.
 *
 * A tabela guarda só as EXCEÇÕES: linha ausente significa "ligado". Guardar a
 * matriz inteira (8 tipos × 4 canais = 32 linhas por usuário) seria escrever
 * 32 mil linhas para mil usuários, quase todas dizendo "sim" — e ainda exigiria
 * uma migração de dados toda vez que um tipo novo aparecesse.
 *
 * Aviso transacional nasce ligado por legítimo interesse (LGPD art. 7º, IX);
 * quem precisa de opt-in explícito é comunicação de marketing, e essa passa
 * pelo consentimento `comunicacao_marketing` em `features/auth`, não por aqui.
 */

/**
 * Mapa `"tipo:canal" → ativo` do usuário, em cache.
 *
 * É consultado uma vez por notificação criada, ou seja, no caminho mais quente
 * do sistema. Sem cache, cada mensagem de chat viraria uma consulta a mais.
 */
async function mapa(usuarioId) {
  return cache.lembrar(
    chaves.preferencias(usuarioId),
    async () => {
      const linhas = await db.NotificacaoPreferencia.findAll({
        where: { usuario_id: usuarioId },
        attributes: ['tipo', 'canal', 'ativo'],
        raw: true,
      });

      /* objeto simples, nunca instância do Sequelize: o cache serializa em
         JSON e uma instância voltaria como um objeto meio vivo, meio morto */
      const resultado = {};
      linhas.forEach((linha) => {
        resultado[`${linha.tipo}:${linha.canal}`] = linha.ativo;
      });
      return resultado;
    },
    { ttl: CONTADOR_TTL_SEGUNDOS, cachearVazio: true }
  );
}

/**
 * Este usuário aceita este tipo neste canal?
 *
 * @param {object} preferencias  mapa já carregado, para não reconsultar dentro
 *                               de um laço de envio em massa
 */
function permiteNoMapa(preferencias, tipo, canal) {
  /* aviso de segurança da própria conta não é silenciável dentro da
     plataforma: desligar "conta suspensa" faria a pessoa descobrir a
     suspensão pelo silêncio */
  if (canal === 'sistema' && TIPOS_NAO_SILENCIAVEIS.includes(tipo)) return true;

  const valor = preferencias[`${tipo}:${canal}`];
  return valor === undefined ? true : Boolean(valor);
}

async function permite(usuarioId, tipo, canal) {
  return permiteNoMapa(await mapa(usuarioId), tipo, canal);
}

/**
 * Matriz completa para a tela de preferências.
 *
 * Devolve todos os cruzamentos, inclusive os que não têm linha no banco — a
 * tela precisa saber que existe um botão "ligado" ali, e deduzir a ausência no
 * front seria repetir a regra de negócio do outro lado da rede.
 */
async function listar(usuarioId) {
  const preferencias = await mapa(usuarioId);

  return TIPOS.map((tipo) => ({
    tipo,
    canais: CANAIS_CONFIGURAVEIS.map((canal) => ({
      canal,
      ativo: permiteNoMapa(preferencias, tipo, canal),
      bloqueado: canal === 'sistema' && TIPOS_NAO_SILENCIAVEIS.includes(tipo),
    })),
  }));
}

/**
 * Grava as preferências enviadas. Substituição parcial: o que não veio no
 * corpo continua como estava — o front pode salvar um único botão sem mandar
 * a matriz inteira e sem risco de zerar o que outra aba acabou de mudar.
 */
async function definir(usuarioId, itens = []) {
  if (!itens.length) return listar(usuarioId);

  const linhas = itens
    /* o não-silenciável é recusado em silêncio, não com erro: o front pode
       mandar a matriz toda de volta, e falhar a requisição inteira por causa
       de um botão que nem é clicável seria hostil sem motivo */
    .filter((item) => !(item.canal === 'sistema' && TIPOS_NAO_SILENCIAVEIS.includes(item.tipo)))
    .map((item) => ({
      usuario_id: usuarioId,
      tipo: item.tipo,
      canal: item.canal,
      ativo: item.ativo !== false,
    }));

  if (linhas.length) {
    /* um upsert em lote no índice único (usuario_id, tipo, canal) — a
       alternativa seria um findOrCreate por item, e a tela manda a matriz
       inteira de uma vez */
    await db.NotificacaoPreferencia.bulkCreate(linhas, {
      updateOnDuplicate: ['ativo', 'atualizado_em'],
      conflictAttributes: ['usuario_id', 'tipo', 'canal'],
    });
  }

  await cache.remover(chaves.preferencias(usuarioId));
  return listar(usuarioId);
}

module.exports = { mapa, permite, permiteNoMapa, listar, definir };
