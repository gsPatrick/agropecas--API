'use strict';

const { QueryTypes } = require('sequelize');
const db = require('../../../models');
const massaService = require('../../notificacao/notificacao.massa.service');
const templateService = require('../../notificacao/notificacao.template.service');
const notificacaoMapper = require('../../notificacao/notificacao.mapper');
const { ENTIDADE_COMUNICADO, CANAIS_ENTREGUES } = require('../../notificacao/notificacao.constants');
const { registrarAcao } = require('../helpers/admin.auditoria.helper');
const { lerFiltros } = require('../helpers/admin.consulta.helper');
const { erros } = require('../../../utils/erros');

/**
 * Comunicados e templates.
 *
 * O envio em si é `notificacao.massa.service`: keyset em blocos de 500,
 * `bulkCreate`, idempotência pelo id do lote. Reimplementar aqui seria copiar a
 * parte difícil do sistema para dentro do painel — e garantir que uma das duas
 * cópias ficasse para trás.
 *
 * O que o painel acrescenta é a **trava de público**.
 *
 * ### Por que o corpo precisa dizer quantas pessoas espera atingir
 *
 * Um comunicado não tem desfazer: quando o Admin percebe que o filtro estava
 * errado, a notificação já está no celular de todo mundo, e um e-mail de
 * retratação para a base inteira só piora. O segmento é montado numa tela com
 * quatro filtros combináveis; esquecer o `tipoPerfil` transforma "avisar as 40
 * lojas de Sorriso" em "avisar os 12 mil cadastros".
 *
 * A trava é simples e funciona porque exige uma segunda afirmação sobre a mesma
 * coisa: o Admin declara o tamanho esperado, o service CONTA o público real
 * antes de enfileirar, e recusa se a diferença passar da tolerância. Uma
 * confirmação do tipo "tem certeza?" não pegaria esse erro — quem errou o
 * filtro clica "sim" com a mesma convicção.
 */

/** divergência aceita quando o corpo não informa outra */
const TOLERANCIA_PADRAO = 0.2;

/**
 * Piso de folga absoluto.
 *
 * Sem ele, público pequeno vira trava impossível: 20% de 3 é 0,6, e o Admin
 * que esperava 3 e encontrou 4 pessoas seria barrado por um acerto trivial. A
 * proteção existe contra a ordem de grandeza errada, não contra o arredondamento.
 */
const FOLGA_MINIMA = 5;

// ─── LISTAGEM ───────────────────────────────────────────────────

/**
 * Comunicados já disparados.
 *
 * Não existe tabela de comunicados: o que existe são as notificações que cada
 * lote gerou, todas com `referencia_tipo = 'comunicados'` e o mesmo
 * `referencia_id`. A lista é, portanto, um `GROUP BY referencia_id` — feito no
 * BANCO, porque o caminho ingênuo (buscar as notificações e agrupar em
 * JavaScript) traria milhares de linhas para a aplicação a fim de devolver
 * dez.
 *
 * Consulta crua e não ORM: o que se quer aqui é um relatório, e agregar com o
 * Sequelize devolveria instâncias falsas com colunas que o model não tem.
 */
async function listar(contexto, query = {}) {
  const filtros = lerFiltros(query, { camposOrdenacao: ['criado_em'], ordemPadrao: 'criado_em' });

  const substituicoes = {
    referencia: ENTIDADE_COMUNICADO,
    limite: filtros.limit,
    deslocamento: filtros.offset,
    inicio: filtros.periodo?.inicio || null,
    fim: filtros.periodo?.fim || null,
  };

  const recorte = filtros.periodo ? 'AND criado_em BETWEEN :inicio AND :fim' : '';

  const linhas = await db.sequelize.query(
    `SELECT referencia_id                                   AS lote_id,
            MIN(tipo)                                       AS tipo,
            MIN(titulo)                                     AS titulo,
            COUNT(*)                                        AS total,
            COUNT(DISTINCT usuario_id)                      AS destinatarios,
            COUNT(*) FILTER (WHERE lida_em IS NOT NULL)     AS lidas,
            ARRAY_AGG(DISTINCT canal::text)                 AS canais,
            MIN(criado_em)                                  AS criado_em
       FROM notificacoes
      WHERE referencia_tipo = :referencia ${recorte}
      GROUP BY referencia_id
      ORDER BY MIN(criado_em) DESC
      LIMIT :limite OFFSET :deslocamento`,
    { replacements: substituicoes, type: QueryTypes.SELECT }
  );

  const [{ total }] = await db.sequelize.query(
    `SELECT COUNT(DISTINCT referencia_id) AS total
       FROM notificacoes
      WHERE referencia_tipo = :referencia ${recorte}`,
    { replacements: substituicoes, type: QueryTypes.SELECT }
  );

  return {
    itens: linhas.map((linha) => ({
      loteId: linha.lote_id,
      tipo: linha.tipo,
      titulo: linha.titulo,
      canais: linha.canais || [],
      destinatarios: Number(linha.destinatarios),
      entregas: Number(linha.total),
      lidas: Number(linha.lidas),
      criadoEm: linha.criado_em,
    })),
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    total: Number(total),
  };
}

// ─── ENVIO ──────────────────────────────────────────────────────

/**
 * Conta o público REAL do segmento.
 *
 * Reaproveita `consultaDoSegmento` do próprio service de massa — é o mesmo
 * `where` que o job vai usar bloco a bloco. Montar um filtro equivalente aqui
 * faria a trava conferir um público diferente do que seria efetivamente
 * atingido, que é o único jeito de uma trava dessas ser pior que nenhuma.
 *
 * `distinct` no `id` porque o segmento por perfil entra como JOIN.
 */
async function contarPublico(segmento = {}) {
  const { where, include } = massaService.consultaDoSegmento(segmento, null);

  return db.Usuario.count({ where, include, distinct: true, col: 'id' });
}

/**
 * Dispara o comunicado, se o público bater.
 *
 * A recusa é 409 (conflito) e não 422: a requisição está bem formada, o que não
 * confere é o estado do mundo. A resposta devolve o número real para que o
 * Admin corrija o campo e reenvie com consciência — devolver só "não confere"
 * o faria adivinhar.
 */
async function enviar(contexto, dados) {
  const { publicoEsperado, tolerancia = TOLERANCIA_PADRAO, ...comunicado } = dados;

  const publicoReal = await contarPublico(comunicado.segmento);
  const folga = Math.max(FOLGA_MINIMA, Math.ceil(publicoEsperado * tolerancia));
  const diferenca = Math.abs(publicoReal - publicoEsperado);

  if (diferenca > folga) {
    throw erros.conflito(
      'O público real do segmento não confere com o informado. Confira os filtros antes de enviar.',
      {
        code: 'PUBLICO_DIVERGENTE',
        publicoEsperado,
        publicoReal,
        diferenca,
        folga,
      }
    );
  }

  /* nada a enviar não é erro nem sucesso silencioso: enfileirar um lote vazio
     criaria um comunicado fantasma na listagem, que ninguém recebeu */
  if (publicoReal === 0) {
    throw erros.invalido('Nenhum usuário se encaixa neste segmento.', { publicoReal: 0 });
  }

  const canais = (comunicado.canais || ['sistema']).filter((canal) =>
    CANAIS_ENTREGUES.includes(canal)
  );

  const lote = await massaService.agendar(contexto, {
    ...comunicado,
    canais: canais.length ? canais : ['sistema'],
  });

  /**
   * Auditoria PRÓPRIA do painel, além da que o service de massa já grava.
   *
   * Não é duplicata: aquela registra "um comunicado foi criado"; esta registra
   * **a conferência de público** — quantas pessoas o Admin disse que atingiria
   * e quantas o sistema encontrou. É esse par de números que uma apuração
   * posterior precisa, e ele não existe em nenhum outro lugar.
   */
  await registrarAcao(contexto, {
    acao: 'enviar_comunicado',
    entidade: 'notificacoes',
    entidadeId: lote.loteId,
    motivo: comunicado.motivo || null,
    depois: {
      titulo: comunicado.titulo,
      canais: lote.canais,
      segmento: comunicado.segmento || {},
      publicoEsperado,
      publicoReal,
    },
  });

  return { ...lote, publicoEsperado, publicoReal };
}

// ─── TEMPLATES ──────────────────────────────────────────────────

/* o mapper da feature já é lista branca do template; um segundo aqui só criaria
   duas verdades sobre o mesmo registro */
const listarTemplates = async () => (await templateService.listar()).map(notificacaoMapper.template);

/**
 * Salvar template.
 *
 * Delegação: o service da feature invalida o cache do par (tipo, canal) e grava
 * a auditoria. Editar o texto que sai para milhares de pessoas em nome da
 * plataforma é ação sensível — sem trilha, ninguém sabe quem trocou o aviso de
 * suspensão de conta.
 *
 * `corpoHtml → corpo_html` acontece aqui, e não no controller, pelo mesmo
 * motivo que o resto da tradução de nomes: o controller só fala HTTP.
 */
async function salvarTemplate(contexto, id, dados) {
  const { corpoHtml, ...resto } = dados;

  const registro = await templateService.atualizar(contexto, id, {
    ...resto,
    ...(corpoHtml === undefined ? {} : { corpo_html: corpoHtml }),
  });

  return notificacaoMapper.template(registro);
}

module.exports = { listar, enviar, contarPublico, listarTemplates, salvarTemplate };
