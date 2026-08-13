'use strict';

const { Op } = require('sequelize');
const db = require('../../../models');
const cache = require('../../../cache');
const { base } = require('../../../cache/chaves');
const solicitacaoService = require('../../lgpd/lgpd.solicitacao.service');
const documentoService = require('../../lgpd/lgpd.documento.service');
const consentimentoService = require('../../lgpd/lgpd.consentimento.service');
const lgpdMapper = require('../../lgpd/lgpd.mapper');
const { PRAZO_RESPOSTA_DIAS, ALERTA_VENCIMENTO_DIAS } = require('../../lgpd/lgpd.constants');

/**
 * Conformidade — a tela do encarregado (DPO).
 *
 * Composição sobre `features/lgpd`: o prazo legal de 15 dias, o registro em
 * `logs_acesso_dado` a cada abertura da fila, o versionamento dos documentos e
 * o hash do texto continuam lá. O painel acrescenta o que só faz sentido numa
 * TELA: a fila ordenada por vencimento com os contadores ao lado, e o número
 * de contas que precisam reaceitar depois de uma publicação.
 */

/**
 * Cache curto do painel de conformidade.
 *
 * Os contadores (abertas · vencendo · atrasadas · consentimentos
 * desatualizados) custam quatro `COUNT` e são pedidos a cada abertura da tela,
 * inclusive nos F5 seguidos de quem está acompanhando um prazo. Sessenta
 * segundos derruba esse custo sem esconder nada relevante: prazo legal é
 * medido em dias.
 *
 * Ainda assim é invalidado nas escritas — responder uma solicitação e ver o
 * contador de "abertas" parado seria motivo para responder de novo.
 */
const TTL_PAINEL = 60;

const chaves = {
  resumo: () => `${base()}:admin:conformidade:resumo`,
  documentos: () => `${base()}:admin:conformidade:documentos`,
  dominio: () => `${base()}:admin:conformidade*`,
};

const invalidarPainel = () => cache.invalidar(chaves.dominio());

/* ─── SOLICITAÇÕES DO TITULAR ──────────────────────────────── */

/**
 * A fila do encarregado.
 *
 * `lgpd.solicitacao.listar` já ordena por prazo (não por criação) e aplica o
 * filtro de escopo na consulta. O que entra aqui é o cabeçalho da tela: quanto
 * está para vencer e qual é o prazo legal — números que o front não deve
 * recalcular, sob pena de calcular diferente do servidor.
 */
async function listarSolicitacoes(contexto, filtros = {}) {
  /* o esquema do painel chama de `vencidas` o que a feature chama de
     `vencendo` — traduzir aqui é mais honesto do que fazer a feature aceitar
     dois nomes para o mesmo filtro */
  const paraFeature = { ...filtros, vencendo: filtros.vencendo ?? filtros.vencidas };

  const [pagina, resumo] = await Promise.all([
    solicitacaoService.listar(contexto, paraFeature),
    cache.lembrar(chaves.resumo(), () => solicitacaoService.resumo(contexto), { ttl: TTL_PAINEL }),
  ]);

  return {
    itens: pagina.itens.map((registro) => lgpdMapper.solicitacao(registro)),
    pagina: pagina.pagina,
    porPagina: pagina.porPagina,
    total: pagina.total,
    resumo: { ...resumo, prazoDias: PRAZO_RESPOSTA_DIAS, alertaDias: ALERTA_VENCIMENTO_DIAS },
  };
}

/** detalhe — a leitura já grava `logs_acesso_dado` dentro do service da feature */
async function verSolicitacao(contexto, id) {
  const registro = await solicitacaoService.obter(id, contexto);
  return lgpdMapper.solicitacao(registro, { detalhe: true });
}

/** auditado por `lgpd.solicitacao.service.responder` (ação + acesso a dado) */
async function responderSolicitacao(contexto, id, dados) {
  const registro = await solicitacaoService.responder(id, dados, contexto);
  await invalidarPainel();
  return lgpdMapper.solicitacao(registro, { detalhe: true });
}

/* ─── DOCUMENTOS LEGAIS ────────────────────────────────────── */

/**
 * Termos e Política: versões e o tamanho do reaceite pendente.
 *
 * `totalDesatualizados` é o número que decide se a publicação pode acontecer
 * agora ou se é melhor esperar: publicar uma versão nova com `exige_novo_aceite`
 * coloca a base inteira na tela de reaceite no próximo acesso. Esconder esse
 * número da tela transformaria uma correção de vírgula em um susto de suporte.
 */
async function listarDocumentos() {
  return cache.lembrar(
    chaves.documentos(),
    async () => {
      const [versoes, vigentes, pendencias] = await Promise.all([
        documentoService.historico(),
        documentoService.vigentes(),
        consentimentoService.totalDesatualizados(),
      ]);

      /**
       * Quem publicou cada versão.
       *
       * O mapper público de propósito não expõe `publicado_por` — o visitante
       * que lê os Termos não tem por que saber o nome de quem os assinou. Mas
       * o histórico do painel existe justamente para prestação de contas, e
       * "versão 2.1, 12/08" sem autor não responde a pergunta que se faz
       * quando o jurídico questiona uma mudança.
       *
       * Uma consulta só para todos os autores, e não uma por versão: o
       * histórico cresce a cada publicação e o laço com `findByPk` dentro é o
       * N+1 que aparece no ano que vem.
       */
      const autoresIds = [...new Set(versoes.map((v) => v.publicado_por).filter(Boolean))];

      const autores = autoresIds.length
        ? await db.Usuario.findAll({
            where: { id: { [Op.in]: autoresIds } },
            attributes: ['id', 'nome'],
          })
        : [];

      const nomePorId = new Map(autores.map((autor) => [autor.id, autor.nome]));

      return {
        vigentes: Object.values(vigentes).map(lgpdMapper.documento),
        versoes: versoes.map((registro) => ({
          ...lgpdMapper.documento(registro),
          publicadoPor: registro.publicado_por
            ? { id: registro.publicado_por, nome: nomePorId.get(registro.publicado_por) || null }
            : null,
          criadoEm: registro.criado_em,
        })),
        /* por tipo: { versaoVigente, aceitaramVersaoVigente, contasAtivas, desatualizados } */
        reaceitePendente: pendencias,
        totalReaceitePendente: Object.values(pendencias).reduce(
          (soma, item) => soma + (item.desatualizados || 0),
          0
        ),
      };
    },
    { ttl: TTL_PAINEL }
  );
}

/**
 * Publica nova versão.
 *
 * Auditado e transacionado por `lgpd.documento.service.publicar`. Aqui só
 * derrubamos o cache do painel: o contador de reaceite muda no mesmo instante
 * e é justamente o número que o Admin vai conferir logo depois de publicar.
 */
async function publicarDocumento(contexto, dados) {
  /**
   * Tradução dos nomes do formulário para os do service.
   *
   * `admin.validators` fala a língua da TELA (`vigenteEm`, `exigirAceite`) e
   * `lgpd.documento.service` fala a do domínio (`vigenteDe`,
   * `exigeNovoAceite`). Sem esta linha, publicar com data futura gravaria a
   * vigência de hoje em silêncio — o pior tipo de bug de conformidade, porque
   * o documento entra no ar antes da data combinada com o jurídico.
   *
   * O título não está no esquema: derivamos de tipo + versão para não gravar
   * nulo numa coluna que a tela de aceite imprime.
   */
  const entrada = {
    tipo: dados.tipo,
    versao: dados.versao,
    conteudo: dados.conteudo,
    titulo: dados.titulo || `${String(dados.tipo).replace(/_/g, ' ')} — versão ${dados.versao}`,
    resumoMudancas: dados.resumoMudancas,
    vigenteDe: dados.vigenteDe || dados.vigenteEm,
    exigeNovoAceite: dados.exigeNovoAceite ?? dados.exigirAceite,
  };

  const documento = await documentoService.publicar(entrada, contexto);
  await invalidarPainel();

  const pendencias = await consentimentoService.totalDesatualizados();

  return {
    documento: lgpdMapper.documento(documento),
    reaceitePendente: pendencias[documento.tipo] || null,
  };
}

module.exports = {
  listarSolicitacoes,
  verSolicitacao,
  responderSolicitacao,
  listarDocumentos,
  publicarDocumento,
  invalidarPainel,
  chaves,
  TTL_PAINEL,
};
