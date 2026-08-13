'use strict';

const db = require('../../models');
const filas = require('../../filas');
const auditoriaService = require('./auditoria.service');
const consulta = require('./auditoria.consulta.service');
const { exigir } = require('../../rbac');
const { RECURSO_ACESSO, BLOCO_EXPORTACAO, LIMITE_EXPORTACAO } = require('./auditoria.constants');

/**
 * Exportação da trilha.
 *
 * Vai para a fila mesmo quando o recorte é pequeno: o tamanho do resultado
 * depende de um filtro que o cliente escolhe, então a versão "rápida" na rota
 * seria rápida até o dia em que alguém pedir o ano inteiro — e esse dia é
 * sempre uma auditoria externa com prazo curto.
 *
 * O pedido em si é auditado. Exportar a trilha é ler ação de outras pessoas em
 * massa; se essa leitura não deixasse rastro, existiria um jeito de vasculhar
 * a plataforma inteira sem aparecer em lugar nenhum.
 */

/** enfileira e devolve o protocolo */
async function solicitar(contexto, filtros, consultaBruta = {}) {
  exigir(contexto, 'auditoria.exportar');
  consulta.recusarFiltroDeExclusao(consultaBruta);

  /* valida a janela AGORA, no pedido: descobrir que o período era inválido só
     quando o job roda deixa o usuário esperando por um erro */
  const { periodo } = consulta.montarWhere(filtros);

  await auditoriaService.registrar(contexto, {
    acao: 'exportar_dados',
    entidade: 'logs_auditoria',
    motivo: filtros.motivo || 'exportação da trilha de auditoria',
    depois: { periodo, formato: filtros.formato || 'json' },
  });

  await auditoriaService.registrarAcessoDado(contexto, {
    titularId: filtros.atorId || null,
    recurso: RECURSO_ACESSO.TRILHA_AUDITORIA,
    motivo: filtros.motivo || 'exportação da trilha de auditoria',
  });

  await filas.enfileirar('auditoria.exportarTrilha', {
    filtros,
    formato: filtros.formato || 'json',
    solicitadoPor: contexto.usuarioId,
  });

  return { status: 'em_processamento', periodo, formato: filtros.formato || 'json' };
}

/**
 * Varre a trilha em blocos, entregando cada bloco a `aoBloco`.
 *
 * Paginação por OFFSET com ordenação ESTÁVEL (`criado_em`, depois `id`): sem o
 * desempate por id, duas linhas gravadas no mesmo milissegundo podem trocar de
 * lugar entre uma página e a seguinte, e a exportação sai com uma repetida e
 * uma faltando — o pior tipo de erro num relatório de conformidade.
 */
async function percorrer(filtros, aoBloco) {
  const { where } = consulta.montarWhere(filtros);
  let offset = 0;
  let total = 0;

  for (;;) {
    const bloco = await db.LogAuditoria.findAll({
      where,
      attributes: consulta.COLUNAS_DETALHE,
      order: [['criado_em', 'ASC'], ['id', 'ASC']],
      offset,
      limit: BLOCO_EXPORTACAO,
      raw: true,
    });

    if (!bloco.length) break;

    await aoBloco(bloco, offset === 0);
    total += bloco.length;
    offset += BLOCO_EXPORTACAO;

    if (bloco.length < BLOCO_EXPORTACAO) break;
    if (total >= LIMITE_EXPORTACAO) break;
  }

  return total;
}

const COLUNAS_CSV = [
  'id',
  'criado_em',
  'ator_id',
  'ator_papel',
  'em_nome_de',
  'acao',
  'entidade',
  'entidade_id',
  'motivo',
  'origem',
];

/** escapa para CSV — a aspa dupla dentro do campo vira duas, como manda o RFC */
const celula = (valor) => {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor instanceof Date ? valor.toISOString() : valor);
  return /[",\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
};

const linhaCsv = (linha) => COLUNAS_CSV.map((coluna) => celula(linha[coluna])).join(';');

/* ponto e vírgula e não vírgula: o Excel em português abre CSV separado por
   vírgula como uma coluna só, e o relatório é lido no Excel, não no terminal */
const cabecalhoCsv = () => COLUNAS_CSV.join(';');

module.exports = { solicitar, percorrer, linhaCsv, cabecalhoCsv, COLUNAS_CSV };
