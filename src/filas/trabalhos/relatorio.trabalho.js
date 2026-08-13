'use strict';

const { Op, fn, col, literal } = require('sequelize');
const { registrar } = require('../registro');
const { FILAS } = require('../definicoes');

/**
 * Trabalhos do domínio de relatório.
 *
 * Dois assuntos, e os dois existem pelo mesmo motivo: **nada caro no caminho
 * da resposta**.
 *
 *   relatorio.exportar       gera o CSV e guarda no storage
 *   relatorio.agregarTermos  consolida `busca_logs` em `termos_populares`
 *
 * Os `require` pesados (models, services) ficam DENTRO do executor, como no
 * `manutencao.trabalho.js`: o arquivo é carregado no boot da API só para
 * registrar os nomes, e carregar a árvore de models aí atrasaria o start de um
 * processo que talvez nunca rode um job.
 */

const EXPORTAR = registrar(
  'relatorio.exportar',
  async ({ protocolo, relatorio, formato = 'csv', de, ate, filtros = {}, solicitanteId, escopoUsuarioId }) => {
    const db = require('../../models');
    const storage = require('../../providers/storage');
    const mapper = require('../../features/relatorio/relatorio.mapper');
    const { lerPeriodo } = require('../../features/relatorio/relatorio.comum');
    const {
      PERIODO_MAX_DIAS_EXPORTACAO,
      EXPORTACAO_VALIDADE_HORAS,
    } = require('../../features/relatorio/relatorio.constants');

    /* o período é revalidado aqui, e não só na rota: um job pode ser
       reenfileirado à mão, e o teto tem que valer para o worker também */
    const periodo = lerPeriodo({ de, ate }, { maxDias: PERIODO_MAX_DIAS_EXPORTACAO });

    let dados;

    if (relatorio === 'painel') {
      dados = await require('../../features/relatorio/relatorio.painel.service').painel(periodo, filtros);
    } else if (relatorio === 'busca') {
      dados = await require('../../features/relatorio/relatorio.busca.service').busca(periodo, filtros);
    } else if (relatorio === 'desempenho') {
      /* o escopo foi congelado quando o pedido foi aceito: o worker não tem
         sessão para reavaliar permissão, então ele NÃO pode escolher o dono.
         Reconstruímos um contexto mínimo apontando para o dono já autorizado */
      const contexto = {
        autenticado: true,
        usuarioId: escopoUsuarioId,
        papeis: [],
        permissoes: new Set(['anuncio.ver_metricas.proprio']),
        admin: false,
      };
      dados = await require('../../features/relatorio/relatorio.desempenho.service').desempenho(
        contexto,
        periodo,
        { top: filtros.top }
      );
    } else {
      throw new Error(`Relatório desconhecido para exportação: ${relatorio}`);
    }

    if (formato !== 'csv') throw new Error(`Formato não suportado: ${formato}`);

    const { cabecalho, linhas } = mapper.paraLinhas[relatorio](dados);
    const conteudo = Buffer.from(mapper.paraCsv(cabecalho, linhas), 'utf8');

    const salvo = await storage.salvar(conteudo, { pasta: 'relatorios', extensao: 'csv' });

    const arquivo = await db.Arquivo.create({
      usuario_id: solicitanteId,
      driver: storage.motor(),
      path: salvo.caminho,
      url: storage.url(salvo.caminho),
      nome_original: `${relatorio}-${periodo.diaDe}-a-${periodo.diaAte}.csv`,
      mime: 'text/csv; charset=utf-8',
      tamanho_bytes: salvo.tamanho,
      referencia_tipo: 'relatorio_exportacao',
      /* `descartar_em` é prazo de validade E gatilho de faxina: o mesmo campo
         que expira o link autoriza a manutenção a apagar o arquivo. Sem ele,
         um CSV com o retrato do negócio ficaria no disco para sempre */
      descartar_em: new Date(Date.now() + EXPORTACAO_VALIDADE_HORAS * 60 * 60 * 1000),
    });

    return { protocolo, arquivoId: arquivo.id, linhas: linhas.length, tamanhoBytes: salvo.tamanho };
  },
  { fila: FILAS.MANUTENCAO.nome }
);

/**
 * Consolida `busca_logs` do dia em `termos_populares`.
 *
 * A landing pergunta "o que é mais procurado hoje" a cada visita e o painel
 * pergunta o mesmo por período: varrer o log cru nessa frequência é caro e
 * fica pior a cada semana de operação. O job roda uma vez por dia, agrega no
 * BANCO (`GROUP BY` + `SUM`) e grava algumas dezenas de linhas.
 *
 * É idempotente: rodar de novo para o mesmo dia recalcula e regrava a mesma
 * linha (chave única `data · termo_normalizado · uf`), nunca duplica. Isso
 * importa porque job de agregação é o primeiro que alguém reexecuta à mão
 * quando desconfia do número.
 *
 * @param dias  quantos dias para trás reprocessar (padrão 1 = ontem e hoje)
 */
const AGREGAR_TERMOS = registrar(
  'relatorio.agregarTermos',
  async ({ dias = 1 } = {}) => {
    const db = require('../../models');
    const { invalidarTudo } = require('../../features/relatorio/relatorio.cache');

    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    desde.setUTCHours(0, 0, 0, 0);

    const linhas = await db.BuscaLog.findAll({
      attributes: [
        [fn('date_trunc', 'day', col('criado_em')), 'dia'],
        'termo_normalizado',
        'uf',
        [fn('MIN', col('termo')), 'exibicao'],
        [fn('COUNT', col('id')), 'total'],
        [fn('SUM', literal('CASE WHEN sem_resultado THEN 1 ELSE 0 END')), 'sem_resultado'],
      ],
      where: {
        criado_em: { [Op.gte]: desde },
        termo_normalizado: { [Op.ne]: null },
      },
      group: [literal('1'), 'termo_normalizado', 'uf'],
      raw: true,
    });

    if (!linhas.length) return { consolidados: 0 };

    const registros = linhas.map((linha) => ({
      data: new Date(linha.dia).toISOString().slice(0, 10),
      termo_normalizado: linha.termo_normalizado,
      termo_exibicao: (linha.exibicao || linha.termo_normalizado).slice(0, 160),
      uf: linha.uf || null,
      total_buscas: Number(linha.total) || 0,
      total_sem_resultado: Number(linha.sem_resultado) || 0,
    }));

    const datas = [...new Set(registros.map((registro) => registro.data))];

    /* apaga e regrava o intervalo em vez de `updateOnDuplicate`: a chave única
       é (data · termo · UF) e `uf` é anulável — no Postgres, NULL nunca
       conflita com NULL, então o upsert duplicaria em silêncio toda busca sem
       UF a cada reexecução. Apagar o dia antes torna o job idempotente de
       verdade.
       `bulkCreate` e não um laço de `save()`: são centenas de linhas por dia. */
    await db.sequelize.transaction(async (transacao) => {
      await db.TermoPopular.destroy({ where: { data: datas }, transaction: transacao });
      await db.TermoPopular.bulkCreate(registros, { transaction: transacao });
    });

    await invalidarTudo();

    return { consolidados: registros.length };
  },
  { fila: FILAS.MANUTENCAO.nome }
);

/** faxina dos CSV vencidos — o link já não abre, o arquivo não pode sobrar */
const LIMPAR_EXPORTACOES = registrar(
  'relatorio.limparExportacoes',
  async () => {
    const db = require('../../models');
    const storage = require('../../providers/storage');

    const vencidos = await db.Arquivo.findAll({
      where: {
        referencia_tipo: 'relatorio_exportacao',
        descartar_em: { [Op.lt]: new Date() },
      },
      attributes: ['id', 'path'],
      limit: 500,
    });

    for (const arquivo of vencidos) {
      await storage.remover(arquivo.path).catch(() => null);
    }

    const removidos = await db.Arquivo.destroy({
      where: { id: vencidos.map((arquivo) => arquivo.id) },
      force: true,
    });

    return { removidos };
  },
  { fila: FILAS.MANUTENCAO.nome }
);

module.exports = { EXPORTAR, AGREGAR_TERMOS, LIMPAR_EXPORTACOES };
