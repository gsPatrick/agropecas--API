'use strict';

const { Op, fn, col, literal } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const { chaves } = require('./relatorio.cache');
const { lerTop, suprimirPequenos, numero } = require('./relatorio.comum');
const { TTL } = require('./relatorio.constants');

/**
 * Painel geral da plataforma — a tela em que a cliente decide onde investir.
 *
 * **Toda contagem deste arquivo acontece no banco.** Nenhuma consulta traz
 * linha para somar em JavaScript: `COUNT`/`SUM` com `GROUP BY` devolvem
 * dezenas de linhas onde `findAll` devolveria centenas de milhares, e a
 * diferença aparece no primeiro mês de operação real, não no teste.
 *
 * As sete perguntas do painel rodam em paralelo (`Promise.all`) porque são
 * independentes: em série, o painel custaria a soma dos tempos em vez do
 * maior deles.
 */

const entreCriacao = (periodo) => ({
  criado_em: { [Op.gte]: periodo.de, [Op.lt]: periodo.ateExclusivo },
});

/** contagem simples com GROUP BY — o `count` do Sequelize já devolve agregado */
async function porColuna(model, coluna, where) {
  const linhas = await model.count({ where, group: [coluna], col: 'id' });
  return linhas.map((linha) => ({ valor: linha[coluna], total: numero(linha.count) }));
}

/** cadastros novos no período, quebrados por papel */
async function usuariosPorPapel(periodo) {
  const linhas = await db.Papel.findAll({
    attributes: ['chave', 'nome', [fn('COUNT', col('usuarios.id')), 'total']],
    include: [
      {
        model: db.Usuario,
        as: 'usuarios',
        attributes: [],
        through: { attributes: [] },
        where: entreCriacao(periodo),
        required: false,
      },
    ],
    group: ['Papel.id'],
    order: [['chave', 'ASC']],
    raw: true,
  });

  return linhas.map((linha) => ({ papel: linha.chave, nome: linha.nome, total: numero(linha.total) }));
}

/**
 * Cadastros por dia — série para o gráfico.
 *
 * `date_trunc` e não agrupamento em JS: trazer um registro por usuário para
 * contar por dia é exatamente o padrão que a revisão rejeita.
 */
async function cadastrosPorDia(periodo) {
  const linhas = await db.Usuario.findAll({
    attributes: [
      [fn('date_trunc', 'day', col('criado_em')), 'dia'],
      [fn('COUNT', col('id')), 'total'],
    ],
    where: entreCriacao(periodo),
    group: [literal('1')],
    order: [literal('1 ASC')],
    raw: true,
  });

  return linhas.map((linha) => ({
    dia: new Date(linha.dia).toISOString().slice(0, 10),
    total: numero(linha.total),
  }));
}

async function anunciosPorCategoria(periodo, top) {
  const linhas = await db.Anuncio.findAll({
    attributes: ['categoria_id', [fn('COUNT', col('Anuncio.id')), 'total']],
    where: entreCriacao(periodo),
    include: [{ model: db.Categoria, as: 'categoria', attributes: ['nome', 'slug'], required: false }],
    group: ['Anuncio.categoria_id', 'categoria.id'],
    order: [[literal('total'), 'DESC']],
    limit: top,
    raw: true,
    nest: true,
  });

  return linhas.map((linha) => ({
    categoriaId: linha.categoria_id,
    categoria: linha.categoria?.nome || 'Sem categoria',
    slug: linha.categoria?.slug || null,
    total: numero(linha.total),
  }));
}

/**
 * Buscas sem resultado — o número mais valioso do painel.
 *
 * Busca com zero resultado é pedido de compra que ninguém atendeu: é a lista
 * do que falta no catálogo e o argumento para chamar lojista novo
 * (`src/models/busca-log.js`).
 *
 * Passa pelo piso de agregação: termo procurado por uma pessoa só, cruzado com
 * a região, identifica essa pessoa para quem conhece o mercado local.
 */
async function buscasSemResultado(periodo, top) {
  const linhas = await db.BuscaLog.findAll({
    attributes: [
      'termo_normalizado',
      [fn('COUNT', col('id')), 'total'],
      [fn('COUNT', fn('DISTINCT', col('sessao_hash'))), 'sessoes'],
    ],
    where: { ...entreCriacao(periodo), sem_resultado: true, termo_normalizado: { [Op.ne]: null } },
    group: ['termo_normalizado'],
    order: [[literal('total'), 'DESC']],
    limit: top * 3, // margem para o que a supressão vai descartar
    raw: true,
  });

  const bruto = linhas.map((linha) => ({
    termo: linha.termo_normalizado,
    total: numero(linha.total),
    sessoes: numero(linha.sessoes),
  }));

  const { itens, ocultados, ocultadosLinhas, minimo } = suprimirPequenos(bruto, (item) => item.total);

  return { itens: itens.slice(0, top), ocultados, ocultadosLinhas, minimoAgregacao: minimo };
}

/**
 * Monta o painel inteiro.
 *
 * @param periodo  saída de `relatorio.comum.lerPeriodo` — já validado com teto
 */
async function painel(periodo, { top = 20 } = {}) {
  const limiteTop = lerTop(top);
  const assinatura = cache.assinatura({ de: periodo.diaDe, ate: periodo.diaAte, top: limiteTop });

  return cache.lembrar(
    chaves.painel(assinatura),
    async () => {
      const janela = entreCriacao(periodo);

      const [
        usuarios,
        usuariosTotal,
        porPapel,
        porDia,
        anunciosPorStatus,
        porCategoria,
        conversas,
        contatosPorCanal,
        buscas,
        semResultado,
      ] = await Promise.all([
        db.Usuario.count({ where: janela }),
        db.Usuario.count(),
        usuariosPorPapel(periodo),
        cadastrosPorDia(periodo),
        porColuna(db.Anuncio, 'status', janela),
        anunciosPorCategoria(periodo, limiteTop),
        db.Conversa.count({ where: janela }),
        porColuna(db.AnuncioContato, 'canal', janela),
        db.BuscaLog.count({ where: janela }),
        buscasSemResultado(periodo, limiteTop),
      ]);

      const totalContatos = contatosPorCanal.reduce((soma, item) => soma + item.total, 0);

      return {
        periodo: { de: periodo.diaDe, ate: periodo.diaAte, dias: periodo.dias },
        usuarios: {
          novos: usuarios,
          total: usuariosTotal,
          porPapel,
          porDia,
        },
        anuncios: {
          criados: anunciosPorStatus.reduce((soma, item) => soma + item.total, 0),
          porStatus: anunciosPorStatus.map((item) => ({ status: item.valor, total: item.total })),
          porCategoria,
        },
        conversas: { iniciadas: conversas },
        contatos: {
          total: totalContatos,
          porCanal: contatosPorCanal.map((item) => ({ canal: item.valor, total: item.total })),
        },
        buscas: {
          total: buscas,
          semResultado: semResultado.itens,
          semResultadoOcultados: semResultado.ocultados,
          minimoAgregacao: semResultado.minimoAgregacao,
        },
      };
    },
    { ttl: TTL.PAINEL }
  );
}

module.exports = { painel };
