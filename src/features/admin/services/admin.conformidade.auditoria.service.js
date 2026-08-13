'use strict';

const cache = require('../../../cache');
const { base } = require('../../../cache/chaves');
const { erros } = require('../../../utils/erros');
const consulta = require('../../auditoria/auditoria.consulta.service');
const exportacaoTrilha = require('../../auditoria/auditoria.exportacao.service');
const auditoriaService = require('../../auditoria/auditoria.service');
const auditoriaMapper = require('../../auditoria/auditoria.mapper');
const { RECURSO_ACESSO } = require('../../auditoria/auditoria.constants');
const painelRelatorio = require('../../relatorio/relatorio.painel.service');
const exportacaoRelatorio = require('../../relatorio/relatorio.exportacao.service');
const { lerPeriodo } = require('../../relatorio/relatorio.comum');

/**
 * Trilha de auditoria e relatórios, pela tela do Admin.
 *
 * Duas propriedades desta fatia não são negociáveis e por isso aparecem como
 * AUSÊNCIA de código, não como validação:
 *
 *   - **a trilha é imutável.** Não existe aqui `atualizar` nem `remover`, e a
 *     rota também não os oferece — nem para o Admin. Uma trilha que o auditado
 *     pode corrigir não prova nada, e a única garantia real disso é não haver
 *     função. O expurgo por retenção é do job de LGPD, que apaga por data e
 *     nunca por alvo;
 *   - **o Admin não filtra as próprias linhas para fora.** Quem recusa é
 *     `auditoria.consulta.recusarFiltroDeExclusao`, e é por isso que este
 *     service exige a query CRUA: o validador descarta campo desconhecido em
 *     silêncio, então sem o bruto a tentativa passaria despercebida em vez de
 *     virar 422.
 */

/**
 * Cota de exportação por administrador.
 *
 * A rota já tem `rateLimit.escrita()`, que é o limite genérico de escrita —
 * generoso demais para esta operação. Exportar varre `logs_auditoria` inteira
 * em blocos e escreve arquivo: cinco pedidos por hora por pessoa cobre
 * qualquer uso legítimo (uma auditoria externa pede um recorte, não vinte) e
 * impede que um botão clicado com raiva enfileire trabalho pesado em série.
 *
 * O contador é por usuário e por tipo, com janela de uma hora no cache
 * compartilhado — em memória seria por instância, ou seja, não seria limite.
 */
const EXPORTACOES_POR_HORA = 5;
const JANELA_SEGUNDOS = 3600;

const chaveCota = (tipo, usuarioId) =>
  `${base()}:admin:exportacao:${tipo}:${usuarioId}:${Math.floor(Date.now() / (JANELA_SEGUNDOS * 1000))}`;

async function garantirCota(contexto, tipo) {
  const usados = await cache.incrementar(chaveCota(tipo, contexto.usuarioId), { ttl: JANELA_SEGUNDOS });

  /* `incrementar` devolve 0 quando o cache está indisponível; nesse caso não
     bloqueamos — negar exportação porque o Redis caiu seria trocar um risco de
     custo por uma indisponibilidade */
  if (usados > EXPORTACOES_POR_HORA) {
    throw erros.muitasTentativas(
      `Limite de ${EXPORTACOES_POR_HORA} exportações por hora atingido. As exportações já pedidas continuam na fila.`,
      { limite: EXPORTACOES_POR_HORA, janelaSegundos: JANELA_SEGUNDOS }
    );
  }
}

/* ─── TRILHA ───────────────────────────────────────────────── */

/**
 * Consulta paginada da trilha.
 *
 * @param consultaBruta  `req.query` como o cliente MANDOU (antes da validação)
 */
async function trilha(contexto, filtros = {}, consultaBruta = {}) {
  const { itens, periodo, ...meta } = await consulta.listar(contexto, filtros, consultaBruta);

  /* abrir a trilha é ler ação de outras pessoas: o próprio ato fica
     registrado, e esse registro o Admin também não consegue apagar */
  await auditoriaService.registrarAcessoDado(contexto, {
    titularId: filtros.atorId || null,
    recurso: RECURSO_ACESSO.TRILHA_AUDITORIA,
    motivo: filtros.motivo || 'consulta à trilha pelo painel administrativo',
  });

  return { itens: itens.map(auditoriaMapper.linha), ...meta, periodo };
}

/**
 * Quem LEU dado pessoal de quem.
 *
 * É a trilha que responde ao titular a pergunta que a de alteração não
 * responde: "quem da plataforma abriu meus dados, e por quê?".
 */
async function acessosADados(contexto, filtros = {}, consultaBruta = {}) {
  consulta.recusarFiltroDeExclusao(consultaBruta);

  const { itens, ...meta } = await consulta.acessosAoTitular(
    contexto,
    { titularId: filtros.titularId, atorId: filtros.atorId },
    filtros
  );

  return { itens: itens.map(auditoriaMapper.acessoDado), ...meta };
}

/**
 * Exportação da trilha — vai para a FILA, sempre.
 *
 * Nunca no caminho da resposta, mesmo com recorte pequeno: o tamanho depende
 * de um filtro que o cliente escolhe, e o dia em que alguém pedir o ano
 * inteiro é sempre o dia de uma auditoria com prazo curto. O arquivo pronto é
 * entregue por link de uso único (`lgpd.link.service`), que queima no
 * primeiro resgate.
 */
async function exportarTrilha(contexto, filtros = {}, consultaBruta = {}) {
  await garantirCota(contexto, 'trilha');
  return exportacaoTrilha.solicitar(contexto, filtros, consultaBruta);
}

/* ─── RELATÓRIOS ───────────────────────────────────────────── */

/**
 * Painel de números da plataforma.
 *
 * `lerPeriodo` (da feature `relatorio`) é quem impõe o teto de dias e monta o
 * período anterior de mesmo tamanho para comparação — o cálculo do recorte não
 * pode ser reescrito aqui, senão a tela do painel e a exportação passariam a
 * devolver números diferentes para o mesmo pedido.
 */
async function relatorios(contexto, query = {}) {
  const periodo = lerPeriodo(query);
  return painelRelatorio.painel(periodo, { top: query.top });
}

/** exportação de relatório: fila + link assinado com validade (padrão §8) */
async function exportarRelatorio(contexto, dados = {}) {
  await garantirCota(contexto, 'relatorio');

  return exportacaoRelatorio.solicitar(contexto, {
    relatorio: dados.relatorio || 'painel',
    de: dados.de,
    ate: dados.ate,
    formato: dados.formato || 'csv',
    filtros: dados.filtros || {},
  });
}

module.exports = {
  trilha,
  acessosADados,
  exportarTrilha,
  relatorios,
  exportarRelatorio,
  EXPORTACOES_POR_HORA,
};
