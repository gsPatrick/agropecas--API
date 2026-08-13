'use strict';

const { Op, fn, col, literal } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const { exigir, pode } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { chaves } = require('./relatorio.cache');
const { lerTop, variacao, numero } = require('./relatorio.comum');
const { TTL } = require('./relatorio.constants');

/**
 * "Meu desempenho" — os números dos anúncios de UM anunciante.
 *
 * Este é o relatório onde vazamento agregado acontece: basta esquecer o filtro
 * de dono numa das somas para que o anunciante veja o movimento do concorrente
 * sem nunca abrir o anúncio dele. Por isso:
 *
 * - o dono é resolvido UMA vez, em `resolverAlvo`, e todas as consultas
 *   recebem o mesmo `usuario_id`;
 * - o filtro está no `WHERE` da consulta, nunca num `.filter()` depois;
 * - o id do dono entra na chave de cache (`relatorio.cache.js`).
 *
 * Os números saem de `anuncio_metricas_diarias`, a tabela já agregada por dia.
 * Varrer evento cru para montar isto seria caro e desnecessário — a tabela
 * existe exatamente para esta pergunta (`src/models/anuncio-metrica-diaria.js`).
 */

const METRICAS = [
  'visualizacoes',
  'visualizacoes_unicas',
  'cliques_whatsapp',
  'conversas_iniciadas',
  'favoritos',
  'compartilhamentos',
];

const somas = () => METRICAS.map((metrica) => [fn('COALESCE', fn('SUM', col(metrica)), 0), metrica]);

/**
 * Quem é o dono dos números pedidos.
 *
 * O `usuarioId` da query só é aceito de quem tem escopo `todos`. Para o
 * anunciante comum, pedir o id do vizinho resulta em 403 — e o 403 vem do
 * RBAC, com a mesma mensagem de qualquer outra negação, sem confirmar se o id
 * existe (padrão §11.5).
 */
function resolverAlvo(contexto, usuarioIdSolicitado) {
  if (!usuarioIdSolicitado || String(usuarioIdSolicitado) === String(contexto.usuarioId)) {
    exigir(contexto, 'anuncio.ver_metricas', { donoId: contexto.usuarioId });
    return contexto.usuarioId;
  }

  exigir(contexto, 'anuncio.ver_metricas', { donoId: usuarioIdSolicitado });
  return usuarioIdSolicitado;
}

/** ids dos anúncios do dono — uma consulta, sem N+1 no laço das métricas */
async function anunciosDoDono(usuarioId) {
  const linhas = await db.Anuncio.findAll({
    where: { usuario_id: usuarioId },
    attributes: ['id'],
    raw: true,
  });
  return linhas.map((linha) => linha.id);
}

/** SUM de todas as métricas numa janela — uma linha de resultado */
async function totais(anuncioIds, de, ate) {
  if (!anuncioIds.length) return Object.fromEntries(METRICAS.map((metrica) => [metrica, 0]));

  const [linha] = await db.AnuncioMetricaDiaria.findAll({
    attributes: somas(),
    where: { anuncio_id: { [Op.in]: anuncioIds }, data: { [Op.between]: [de, ate] } },
    raw: true,
  });

  return Object.fromEntries(METRICAS.map((metrica) => [metrica, numero(linha?.[metrica])]));
}

/** série diária para o gráfico — já vem agrupada do banco */
async function serie(anuncioIds, de, ate) {
  if (!anuncioIds.length) return [];

  const linhas = await db.AnuncioMetricaDiaria.findAll({
    attributes: ['data', ...somas()],
    where: { anuncio_id: { [Op.in]: anuncioIds }, data: { [Op.between]: [de, ate] } },
    group: ['data'],
    order: [['data', 'ASC']],
    raw: true,
  });

  return linhas.map((linha) => ({
    data: linha.data,
    ...Object.fromEntries(METRICAS.map((metrica) => [metrica, numero(linha[metrica])])),
  }));
}

/** ranking dos próprios anúncios — o que a pessoa quer saber para renovar */
async function porAnuncio(anuncioIds, de, ate, top) {
  if (!anuncioIds.length) return [];

  const linhas = await db.AnuncioMetricaDiaria.findAll({
    attributes: ['anuncio_id', ...somas()],
    where: { anuncio_id: { [Op.in]: anuncioIds }, data: { [Op.between]: [de, ate] } },
    include: [{ model: db.Anuncio, as: 'anuncio', attributes: ['titulo', 'slug', 'status'], required: true }],
    group: ['AnuncioMetricaDiaria.anuncio_id', 'anuncio.id'],
    order: [[literal('visualizacoes'), 'DESC']],
    limit: top,
    raw: true,
    nest: true,
  });

  return linhas.map((linha) => ({
    anuncioId: linha.anuncio_id,
    titulo: linha.anuncio?.titulo,
    slug: linha.anuncio?.slug,
    status: linha.anuncio?.status,
    ...Object.fromEntries(METRICAS.map((metrica) => [metrica, numero(linha[metrica])])),
  }));
}

/**
 * Desempenho do anunciante, com comparação com o período anterior de mesmo
 * tamanho (ver `relatorio.comum.lerPeriodo`).
 */
async function desempenho(contexto, periodo, { usuarioId, top = 10 } = {}) {
  const dono = resolverAlvo(contexto, usuarioId);
  if (!dono) throw erros.naoAutenticado('É preciso estar autenticado.');

  const limiteTop = lerTop(top);
  const assinatura = cache.assinatura({ de: periodo.diaDe, ate: periodo.diaAte, top: limiteTop });

  const dados = await cache.lembrar(
    chaves.desempenho(dono, assinatura),
    async () => {
      const anuncioIds = await anunciosDoDono(dono);

      const [atual, anterior, diaria, ranking, ativos] = await Promise.all([
        totais(anuncioIds, periodo.diaDe, periodo.diaAte),
        totais(anuncioIds, periodo.anterior.diaDe, periodo.anterior.diaAte),
        serie(anuncioIds, periodo.diaDe, periodo.diaAte),
        porAnuncio(anuncioIds, periodo.diaDe, periodo.diaAte, limiteTop),
        db.Anuncio.count({ where: { usuario_id: dono, status: 'publicado' } }),
      ]);

      const comparacao = Object.fromEntries(
        METRICAS.map((metrica) => [
          metrica,
          { atual: atual[metrica], anterior: anterior[metrica], variacaoPercentual: variacao(atual[metrica], anterior[metrica]) },
        ])
      );

      return {
        periodo: { de: periodo.diaDe, ate: periodo.diaAte, dias: periodo.dias },
        periodoAnterior: { de: periodo.anterior.diaDe, ate: periodo.anterior.diaAte },
        /* devolvido para a tela deixar claro de QUEM é o número — quando o
           Admin consulta o de terceiro, a origem não pode ficar implícita */
        usuarioId: dono,
        anunciosPublicados: ativos,
        totais: atual,
        comparacao,
        serie: diaria,
        porAnuncio: ranking,
      };
    },
    { ttl: TTL.DESEMPENHO }
  );

  /* `proprio` depende de QUEM está olhando, não do dono dos números, e por
     isso é calculado FORA do cache. Guardá-lo junto fazia o Admin receber o
     `proprio: true` gravado pela consulta que o próprio anunciante tinha feito
     minutos antes — mesma entrada de cache, leitor diferente. Nada vazava
     (os números já eram do mesmo dono), mas é exatamente o mecanismo que
     vazaria se um dia um campo sensível ao leitor entrasse no payload. */
  return { ...dados, proprio: String(dono) === String(contexto.usuarioId) };
}

/** usado pelo controller para decidir se a rota aceita `usuarioId` na query */
const podeVerDeTerceiro = (contexto) => pode(contexto, 'anuncio.ver_metricas', { donoId: '__terceiro__' });

module.exports = { desempenho, podeVerDeTerceiro, METRICAS };
