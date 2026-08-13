'use strict';

const db = require('../../models');
const cache = require('../../cache');
const tempoReal = require('../../tempo-real');
const { chaves } = require('./notificacao.cache');
const { CONTADOR_TTL_SEGUNDOS, CONTADOR_TETO } = require('./notificacao.constants');

/**
 * Contador de não lidas — o número no sininho.
 *
 * É o endpoint mais chamado da API inteira: o front pede a cada navegação, em
 * toda tela. Duas decisões saem daí:
 *
 * 1. **Cache com invalidação na escrita.** Um `COUNT(*)` por requisição, vezes
 *    todo mundo navegando, é carga constante no banco para responder um número
 *    que quase nunca muda. O valor certo é regravado sempre que uma notificação
 *    nasce ou é lida; o TTL de 5 minutos é só rede de segurança para o caso de
 *    um processo morrer no meio da invalidação.
 *
 * 2. **Contagem com teto.** Ninguém lê "1.284 não lidas" — o front mostra
 *    "99+". Parar de contar em 100 transforma uma varredura de todas as linhas
 *    do usuário numa leitura de no máximo 100 entradas do índice
 *    `(usuario_id, lida_em)`.
 *
 * A referência de padrão é `conversa_participantes.nao_lidas`, que mantém o
 * contador em coluna. Aqui não há coluna equivalente em `notificacoes` (o
 * contador seria por usuário, não por linha), então a coluna vira cache — o
 * mesmo princípio, num lugar diferente.
 */

const SQL_CONTAGEM = `
  SELECT COUNT(*)::int AS total
  FROM (
    SELECT 1
    FROM notificacoes
    WHERE usuario_id = :usuarioId
      AND canal = 'sistema'
      AND lida_em IS NULL
    LIMIT :teto
  ) AS limitado
`;

async function contarNoBanco(usuarioId) {
  const [linha] = await db.sequelize.query(SQL_CONTAGEM, {
    replacements: { usuarioId, teto: CONTADOR_TETO },
    type: db.Sequelize.QueryTypes.SELECT,
  });

  return Number(linha?.total || 0);
}

/** número atual, do cache quando houver */
async function atual(usuarioId) {
  const total = await cache.lembrar(
    chaves.contador(usuarioId),
    () => contarNoBanco(usuarioId),
    { ttl: CONTADOR_TTL_SEGUNDOS, cachearVazio: true }
  );

  return {
    naoLidas: total,
    teto: CONTADOR_TETO,
    /* o front usa isto para escrever "99+" em vez de um número que mente */
    excedeuTeto: total >= CONTADOR_TETO,
  };
}

/** derruba o cache de um usuário — chamado em toda escrita que muda o número */
const invalidar = (usuarioId) => cache.remover(chaves.contador(usuarioId));

/**
 * Derruba o cache de muita gente de uma vez.
 *
 * Uma remoção por usuário num laço com `await` viraria N round-trips ao Redis
 * no meio de um envio em massa; o adaptador aceita a lista inteira num comando.
 */
const invalidarMuitos = (usuarioIds = []) =>
  cache.remover(usuarioIds.filter(Boolean).map(chaves.contador));

/**
 * Recalcula e avisa o usuário em tempo real.
 *
 * O evento é entrega complementar: o número já está correto no banco e no
 * cache antes de qualquer `emit`. Se o WebSocket estiver fora, o sininho
 * acerta na próxima navegação.
 */
async function atualizarEEmitir(usuarioId) {
  await invalidar(usuarioId);
  const contagem = await atual(usuarioId);

  tempoReal.paraUsuario(usuarioId, tempoReal.EVENTOS.CONTADOR_ATUALIZADO, contagem);
  return contagem;
}

module.exports = { atual, invalidar, invalidarMuitos, atualizarEEmitir, contarNoBanco };
