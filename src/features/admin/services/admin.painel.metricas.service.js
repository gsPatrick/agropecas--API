'use strict';

const { Op, fn, col, literal } = require('sequelize');
const db = require('../../../models');
const cache = require('../../../cache');
const filas = require('../../../filas');
const redis = require('../../../providers/redis');
const { erros } = require('../../../utils/erros');
const { lerPeriodo } = require('../helpers/admin.consulta.helper');
const compartilhado = require('./admin.shared');

/**
 * Números por período (os gráficos) e estado da infraestrutura.
 *
 * **Toda agregação deste arquivo acontece no banco.** `date_trunc` + `GROUP BY`
 * devolvem uma linha por dia onde `findAll` devolveria uma por registro — e a
 * diferença não aparece no teste com trinta cadastros, aparece no primeiro mês
 * de operação real, quando a série de 90 dias passa a trazer dezenas de
 * milhares de linhas para somar em JavaScript.
 *
 * O período já chega com teto: `admin.consulta.helper.lerPeriodo` recusa
 * janela maior que 366 dias. Sem isso, "desde sempre" varre a tabela inteira.
 */

/** série diária de uma tabela qualquer, contada no banco */
async function serieDiaria(model, { inicio, fim }, coluna = 'criado_em', where = {}) {
  const linhas = await model.findAll({
    attributes: [
      [fn('date_trunc', 'day', col(coluna)), 'dia'],
      [fn('COUNT', col('id')), 'total'],
    ],
    where: { ...where, [coluna]: { [Op.gte]: inicio, [Op.lte]: fim } },
    group: [literal('1')],
    order: [literal('1 ASC')],
    raw: true,
  });

  return linhas.map((linha) => ({
    dia: new Date(linha.dia).toISOString().slice(0, 10),
    total: compartilhado.numero(linha.total),
  }));
}

/** quebra por coluna categórica — `count` com `group` já volta agregado */
async function porColuna(model, coluna, where) {
  const linhas = await model.count({ where, group: [coluna], col: 'id' });
  return linhas.map((linha) => ({ valor: linha[coluna], total: compartilhado.numero(linha.count) }));
}

/** trinta dias quando ninguém informou nada — a janela que a tela abre por padrão */
function janela(query) {
  return (
    lerPeriodo(query) || {
      inicio: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      fim: new Date(),
    }
  );
}

/**
 * Séries para os gráficos do painel.
 *
 * Como no resumo, cada bloco depende da capacidade de quem pergunta, e a
 * assinatura de capacidades entra na chave do cache — um gráfico calculado
 * para o Admin não pode ser servido a quem não podia pedi-lo.
 */
async function metricas(contexto, query = {}) {
  const cap = compartilhado.capacidades(contexto);
  const periodo = janela(query);

  const assinatura = cache.assinatura({
    de: periodo.inicio.toISOString().slice(0, 10),
    ate: periodo.fim.toISOString().slice(0, 10),
    cap: compartilhado.assinaturaDeCapacidades(cap),
  });

  return cache.lembrar(
    compartilhado.chaves.metricas(assinatura),
    async () => {
      const entre = { criado_em: { [Op.gte]: periodo.inicio, [Op.lte]: periodo.fim } };

      const [cadastros, anuncios, denuncias, anunciosPorStatus, denunciasPorStatus] = await Promise.all([
        cap.usuarios ? serieDiaria(db.Usuario, periodo) : null,
        cap.anuncios ? serieDiaria(db.Anuncio, periodo) : null,
        cap.denuncias ? serieDiaria(db.Denuncia, periodo) : null,
        cap.anuncios ? porColuna(db.Anuncio, 'status', entre) : null,
        cap.denuncias ? porColuna(db.Denuncia, 'status', entre) : null,
      ]);

      const total = (serie) => (serie || []).reduce((soma, ponto) => soma + ponto.total, 0);

      const saida = {
        periodo: {
          de: periodo.inicio.toISOString().slice(0, 10),
          ate: periodo.fim.toISOString().slice(0, 10),
          dias: Math.max(1, Math.round((periodo.fim - periodo.inicio) / 86400000)),
        },
      };

      if (cap.usuarios) saida.usuarios = { total: total(cadastros), porDia: cadastros };
      if (cap.anuncios) {
        saida.anuncios = {
          total: total(anuncios),
          porDia: anuncios,
          porStatus: anunciosPorStatus.map((linha) => ({ status: linha.valor, total: linha.total })),
        };
      }
      if (cap.denuncias) {
        saida.denuncias = {
          total: total(denuncias),
          porDia: denuncias,
          porStatus: denunciasPorStatus.map((linha) => ({ status: linha.valor, total: linha.total })),
        };
      }

      return saida;
    },
    { ttl: compartilhado.TTL.METRICAS }
  );
}

/**
 * Estado do banco, do cache e das filas.
 *
 * **Restrito a quem tem o coringa.** A rota usa `somenteAdmin`, mas esse
 * middleware confere `admin.acessar` — que o moderador e o suporte também têm.
 * Estado de infraestrutura (motor de cache, tamanho das filas, latência do
 * banco) é reconhecimento de ambiente: não muda a vida de quem modera e ajuda
 * quem estiver sondando. A trava real é aqui, no servidor.
 *
 * A checagem do banco é um `SELECT 1` cronometrado, e não um `count`: o que
 * interessa é "a conexão responde e em quanto tempo", não quantas linhas
 * existem. Nada aqui é cacheado — um painel de saúde que responde do cache
 * mente exatamente no momento em que alguém precisa dele.
 */
async function saude(contexto) {
  if (!contexto?.admin) {
    throw erros.semPermissao('O estado da infraestrutura é restrito ao administrador.', {
      permissao: 'admin.acessar (coringa)',
    });
  }

  const medir = async (executar) => {
    const comeco = Date.now();
    try {
      const detalhe = await executar();
      return { ok: true, latenciaMs: Date.now() - comeco, ...(detalhe || {}) };
    } catch (erro) {
      /* a mensagem do driver pode conter host e usuário: só o resumo sai */
      return { ok: false, latenciaMs: Date.now() - comeco, erro: erro.name || 'FalhaDeConexao' };
    }
  };

  const [banco, fila] = await Promise.all([
    medir(async () => {
      await db.sequelize.query('SELECT 1');
      return { dialeto: db.sequelize.getDialect() };
    }),
    medir(async () => ({ motor: filas.motor(), filas: await filas.estatisticas() })),
  ]);

  const cacheEstado = { ok: true, motor: cache.motor(), redis: redis.disponivel() };

  return {
    ok: banco.ok && fila.ok,
    banco,
    cache: cacheEstado,
    filas: fila,
    processo: {
      ambiente: process.env.NODE_ENV || 'development',
      uptimeSegundos: Math.round(process.uptime()),
      memoriaMb: Math.round(process.memoryUsage().rss / 1048576),
    },
    verificadoEm: new Date().toISOString(),
  };
}

module.exports = { metricas, saude, serieDiaria };
