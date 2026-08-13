'use strict';

const { Op, fn, col, literal } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const { chaves } = require('./relatorio.cache');
const { lerTop, suprimirPequenos, numero } = require('./relatorio.comum');
const { TTL } = require('./relatorio.constants');

/**
 * Relatório de busca — o que o mercado procura e o que a plataforma não tem.
 *
 * Lê `termos_populares`, o consolidado diário, e não `busca_logs` cru. A
 * diferença é de ordem de grandeza: o log tem uma linha por busca, o
 * consolidado tem uma por termo/dia/UF. Quem alimenta o consolidado é o job
 * `relatorio.agregarTermos` (`src/filas/trabalhos/relatorio.trabalho.js`).
 *
 * A exceção é "filtros mais usados", que só existe no log — mas ali a
 * consulta é `COUNT` por coluna, sem trazer linha nenhuma para a aplicação.
 *
 * **Privacidade:** termo de busca é dado de comportamento. Um termo muito
 * específico, procurado por uma pessoa só, cruzado com a UF, identifica quem
 * procurou. Todo recorte por termo passa pelo piso de agregação
 * (`MINIMO_AGREGACAO`) e o que não passa volta somado em `ocultados`.
 */

const entreDatas = (periodo) => ({ data: { [Op.between]: [periodo.diaDe, periodo.diaAte] } });

async function termosMaisBuscados(periodo, top, uf) {
  const where = { ...entreDatas(periodo) };
  if (uf) where.uf = uf;

  const linhas = await db.TermoPopular.findAll({
    attributes: [
      'termo_normalizado',
      [fn('MIN', col('termo_exibicao')), 'exibicao'],
      [fn('SUM', col('total_buscas')), 'total'],
      [fn('SUM', col('total_sem_resultado')), 'sem_resultado'],
    ],
    where,
    group: ['termo_normalizado'],
    order: [[literal('total'), 'DESC']],
    limit: top * 3,
    raw: true,
  });

  const bruto = linhas.map((linha) => ({
    termo: linha.exibicao || linha.termo_normalizado,
    termoNormalizado: linha.termo_normalizado,
    total: numero(linha.total),
    semResultado: numero(linha.sem_resultado),
  }));

  const supressao = suprimirPequenos(bruto, (item) => item.total);
  return { ...supressao, itens: supressao.itens.slice(0, top) };
}

/**
 * Termos que não encontraram nada.
 *
 * Sai do consolidado quando existe e cai no log cru como reserva — o job
 * diário ainda não rodou no dia corrente, e o Admin que abre o painel de manhã
 * precisa ver o de ontem à noite.
 */
async function termosSemResultado(periodo, top) {
  const consolidado = await db.TermoPopular.findAll({
    attributes: [
      'termo_normalizado',
      [fn('MIN', col('termo_exibicao')), 'exibicao'],
      [fn('SUM', col('total_sem_resultado')), 'total'],
    ],
    where: { ...entreDatas(periodo), total_sem_resultado: { [Op.gt]: 0 } },
    group: ['termo_normalizado'],
    order: [[literal('total'), 'DESC']],
    limit: top * 3,
    raw: true,
  });

  const bruto = consolidado.map((linha) => ({
    termo: linha.exibicao || linha.termo_normalizado,
    total: numero(linha.total),
  }));

  const supressao = suprimirPequenos(bruto, (item) => item.total);
  return { ...supressao, itens: supressao.itens.slice(0, top) };
}

/**
 * Quais filtros as pessoas usam.
 *
 * `COUNT(coluna)` no Postgres ignora NULL, então uma consulta só responde
 * "quantas buscas usaram categoria, quantas usaram marca, quantas usaram
 * município" sem trazer uma linha sequer para a aplicação.
 */
async function filtrosMaisUsados(periodo) {
  const [linha] = await db.BuscaLog.findAll({
    attributes: [
      [fn('COUNT', col('id')), 'total'],
      [fn('COUNT', col('categoria_id')), 'categoria'],
      [fn('COUNT', col('marca_id')), 'marca'],
      [fn('COUNT', col('maquina_id')), 'maquina'],
      [fn('COUNT', col('municipio_id')), 'municipio'],
      [fn('COUNT', col('uf')), 'uf'],
      [fn('COUNT', col('termo_normalizado')), 'termo'],
      [fn('COUNT', col('clicou_em_anuncio_id')), 'clique'],
      [fn('SUM', literal('CASE WHEN sem_resultado THEN 1 ELSE 0 END')), 'sem_resultado'],
    ],
    where: { criado_em: { [Op.gte]: periodo.de, [Op.lt]: periodo.ateExclusivo } },
    raw: true,
  });

  const total = numero(linha?.total);
  const percentual = (valor) => (total ? Math.round((numero(valor) / total) * 1000) / 10 : 0);

  return {
    totalBuscas: total,
    semResultado: numero(linha?.sem_resultado),
    taxaSemResultado: percentual(linha?.sem_resultado),
    /* taxa de clique: busca que não vira clique é catálogo que não convence,
       mesmo tendo resultado — é diferente de busca sem resultado nenhum */
    taxaClique: percentual(linha?.clique),
    porFiltro: [
      { filtro: 'termo', total: numero(linha?.termo), percentual: percentual(linha?.termo) },
      { filtro: 'categoria', total: numero(linha?.categoria), percentual: percentual(linha?.categoria) },
      { filtro: 'marca', total: numero(linha?.marca), percentual: percentual(linha?.marca) },
      { filtro: 'maquina', total: numero(linha?.maquina), percentual: percentual(linha?.maquina) },
      { filtro: 'municipio', total: numero(linha?.municipio), percentual: percentual(linha?.municipio) },
      { filtro: 'uf', total: numero(linha?.uf), percentual: percentual(linha?.uf) },
    ].sort((a, b) => b.total - a.total),
  };
}

async function busca(periodo, { top = 20, uf = null } = {}) {
  const limiteTop = lerTop(top);
  const assinatura = cache.assinatura({ de: periodo.diaDe, ate: periodo.diaAte, top: limiteTop, uf });

  return cache.lembrar(
    chaves.busca(assinatura),
    async () => {
      const [populares, semResultado, filtros] = await Promise.all([
        termosMaisBuscados(periodo, limiteTop, uf),
        termosSemResultado(periodo, limiteTop),
        filtrosMaisUsados(periodo),
      ]);

      return {
        periodo: { de: periodo.diaDe, ate: periodo.diaAte, dias: periodo.dias },
        uf,
        minimoAgregacao: populares.minimo,
        termosMaisBuscados: populares.itens,
        termosOcultados: populares.ocultados,
        termosSemResultado: semResultado.itens,
        termosSemResultadoOcultados: semResultado.ocultados,
        filtros,
      };
    },
    { ttl: TTL.BUSCA }
  );
}

module.exports = { busca, termosMaisBuscados, termosSemResultado, filtrosMaisUsados };
