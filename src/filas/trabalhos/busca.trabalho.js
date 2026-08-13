'use strict';

const { registrar } = require('../registro');
const { FILAS } = require('../definicoes');
const {
  TRABALHO_LOG,
  TRABALHO_TERMOS,
  RETENCAO_LOG_DIAS,
} = require('../../features/busca/busca.constants');

/**
 * Trabalhos da busca.
 *
 * Dois papéis bem diferentes convivendo no mesmo arquivo porque compartilham o
 * namespace `busca.*`:
 *
 *  • `busca.registrarLog` — alta frequência, uma execução por busca. Tira do
 *    caminho da resposta o INSERT em `busca_logs`. É o trabalho mais chamado
 *    do sistema depois do envio de e-mail.
 *  • `busca.agregarTermosPopulares` — baixa frequência, periódico. Consolida o
 *    log cru em `termos_populares`, que é o que a home lê.
 *
 * Os services são carregados DENTRO do executor, não no topo. Motivo: este
 * arquivo é lido por `filas/index.js` no boot da aplicação inteira, e importar
 * a feature ali acima puxaria models e cache para dentro do processo do web
 * mesmo quando nenhum job vai rodar — além de criar um ciclo, já que o service
 * importa `filas` para enfileirar.
 */

const REGISTRAR_LOG = registrar(
  TRABALHO_LOG,
  async (dados) => {
    const logService = require('../../features/busca/busca.log.service');
    await logService.gravar(dados);
    return { registrado: true, termo: dados?.termoNormalizado || null };
  },
  /* vai na fila de INDEXACAO, que já é a das rotinas de busca. Não usa a fila
     de MANUTENCAO de propósito: aquela tem concorrência 1 e um job pesado de
     limpeza seguraria o log de busca atrás dele por minutos */
  { fila: FILAS.INDEXACAO.nome }
);

/**
 * Agregação periódica dos termos.
 *
 * Reprocessa o dia inteiro a cada execução, e não "o que entrou desde a última
 * vez". Assim o job é idempotente: rodar duas vezes, rodar atrasado ou
 * reprocessar depois de um incidente dá o mesmo resultado. Um agregador
 * incremental que perde uma execução fica errado para sempre, e ninguém
 * descobre — o número simplesmente fica menor do que deveria.
 *
 * Também recalcula ONTEM: uma busca feita às 23h59 pode ser gravada pelo
 * worker às 00h00 do dia seguinte, e sem isso ela ficaria de fora do agregado
 * dos dois dias.
 */
const AGREGAR_TERMOS = registrar(
  TRABALHO_TERMOS,
  async (dados = {}) => {
    const termoService = require('../../features/busca/busca.termo.service');
    const chavesCache = require('../../features/busca/busca.cache');

    const hoje = new Date();
    const ontem = new Date(hoje.getTime() - 24 * 60 * 60 * 1000);

    const resultado = {
      hoje: await termoService.agregarDia(hoje),
      ontem: await termoService.agregarDia(ontem),
    };

    /* o descarte do log cru anda junto com a agregação: só faz sentido apagar
       o detalhe depois que o agregado dele existe */
    if (dados.descartarAntigos !== false) {
      resultado.descarte = await termoService.descartarLogsAntigos(
        dados.retencaoDias || RETENCAO_LOG_DIAS
      );
    }

    /* o cache da home guarda os termos por 10 minutos; sem invalidar, o
       resultado do job levaria esse tempo a mais para aparecer na tela */
    await chavesCache.invalidarTermos();

    return resultado;
  },
  { fila: FILAS.MANUTENCAO.nome }
);

module.exports = { REGISTRAR_LOG, AGREGAR_TERMOS };
