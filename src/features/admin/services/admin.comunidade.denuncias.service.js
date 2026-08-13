'use strict';

const { Op } = require('sequelize');
const db = require('../../../models');
const consultaService = require('../../denuncia/denuncia.consulta.service');
const resolucaoService = require('../../denuncia/denuncia.resolucao.service');
const denunciaMapper = require('../../denuncia/denuncia.mapper');
const { ENTIDADE } = require('../../denuncia/denuncia.constants');
const { registrarAcao } = require('../helpers/admin.auditoria.helper');
const { lerFiltros } = require('../helpers/admin.consulta.helper');
const { invalidarPainel } = require('./admin.shared');

/**
 * Denúncias no painel — a fila de trabalho da moderação.
 *
 * **Compõe, não reimplementa.** Quem sabe o que é uma fila priorizada, quem
 * decide que ninguém julga a própria denúncia e quem notifica os denunciantes
 * continua sendo `src/features/denuncia`. O que o painel acrescenta é o
 * CONTEXTO: a fila da feature devolve `alvo_tipo`/`alvo_id` crus, e o moderador
 * precisa ver o título do anúncio e o nome de quem foi denunciado para decidir
 * sem abrir cinco abas.
 *
 * ### Por que isso não vira N+1
 *
 * A página inteira sai de um número FIXO de consultas, independentemente de
 * quantas denúncias tenham vindo:
 *
 *   1. uma consulta para a página, já com a contagem de denúncias no mesmo alvo
 *      (subconsulta correlacionada `PRIORIDADE`, da própria feature) e com o
 *      denunciado por JOIN;
 *   2. **no máximo quatro** consultas para resolver os alvos — uma por
 *      `alvo_tipo` presente na página (anúncio, perfil, mensagem, conversa).
 *
 * O alvo é polimórfico e não há JOIN possível: `alvo_id` aponta para tabelas
 * diferentes conforme `alvo_tipo`. Resolver por tipo mantém o custo constante
 * (4 é o tamanho do enum), enquanto resolver por linha cresceria com a página —
 * que é exatamente a definição do N+1 que queremos evitar.
 */

/** denunciado, com o mínimo que a linha da fila precisa mostrar */
const DENUNCIADO = () => ({
  model: db.Usuario,
  as: 'denunciado',
  attributes: ['id', 'nome', 'status'],
  include: [
    {
      model: db.Perfil,
      as: 'perfil',
      attributes: ['id', 'slug', 'tipo', 'nome_exibicao', 'foto_url', 'verificado_em'],
    },
  ],
});

/** colunas por onde a fila pode ser ordenada — lista branca do `ORDER BY` */
const ORDENAVEIS = ['criado_em', 'status', 'motivo', 'alvo_tipo'];

// ─── MAPPERS (lista branca) ─────────────────────────────────────

/**
 * O denunciante NÃO aparece — nem aqui, nem em lugar nenhum que o denunciado
 * possa alcançar. A decisão é da feature `denuncia` (ver o cabeçalho de
 * `denuncia.mapper.js`) e o painel a respeita: quem precisa da identidade para
 * apurar usa `itemComDenunciante`, que só sai depois de
 * `lgpd.acessar_dado_pessoal` e com a leitura registrada.
 */
const denunciado = (usuario) => {
  if (!usuario) return null;
  const perfil = usuario.perfil || null;

  return {
    id: usuario.id,
    nome: perfil?.nome_exibicao || usuario.nome,
    slug: perfil?.slug || null,
    tipo: perfil?.tipo || null,
    fotoUrl: perfil?.foto_url || null,
    verificado: Boolean(perfil?.verificado_em),
    status: usuario.status,
  };
};

/** resumo do alvo: só o suficiente para o moderador reconhecer do que se trata */
const alvo = (tipo, registro) => {
  if (!registro) return null;

  const resumos = {
    anuncio: () => ({
      titulo: registro.titulo,
      slug: registro.slug,
      codigo: registro.codigo,
      status: registro.status,
    }),
    perfil: () => ({
      nome: registro.nome_exibicao,
      slug: registro.slug,
      tipo: registro.tipo,
    }),
    /* o TEXTO da mensagem não entra na lista: ler conteúdo privado é a operação
       do §4 e passa por `verConversa`, com motivo e registro de acesso */
    mensagem: () => ({
      conversaId: registro.conversa_id,
      remetenteId: registro.remetente_id,
      removida: Boolean(registro.removida_em),
      criadoEm: registro.criado_em,
    }),
    conversa: () => ({
      anuncioId: registro.anuncio_id,
      status: registro.status,
      totalMensagens: registro.total_mensagens,
    }),
  };

  return { tipo, id: registro.id, ...(resumos[tipo] ? resumos[tipo]() : {}) };
};

const linha = (registro, alvos) => ({
  ...denunciaMapper.item(registro),
  denunciado: denunciado(registro.denunciado),
  alvo: alvo(registro.alvo_tipo, alvos.get(`${registro.alvo_tipo}:${registro.alvo_id}`)),
});

// ─── RESOLUÇÃO DOS ALVOS ────────────────────────────────────────

/** model e colunas de cada tipo de alvo — nada fora daqui é carregado */
const FONTES = {
  anuncio: { model: () => db.Anuncio, attributes: ['id', 'titulo', 'slug', 'codigo', 'status'] },
  perfil: { model: () => db.Perfil, attributes: ['id', 'slug', 'tipo', 'nome_exibicao'] },
  mensagem: {
    model: () => db.Mensagem,
    attributes: ['id', 'conversa_id', 'remetente_id', 'removida_em', 'criado_em'],
  },
  conversa: {
    model: () => db.Conversa,
    attributes: ['id', 'anuncio_id', 'status', 'total_mensagens'],
  },
};

/**
 * Uma consulta por TIPO presente na página — no máximo quatro, sempre.
 * Devolve um mapa `tipo:id → registro` para o mapper montar sem varrer listas.
 */
async function carregarAlvos(denuncias) {
  const porTipo = new Map();

  denuncias.forEach((registro) => {
    if (!FONTES[registro.alvo_tipo] || !registro.alvo_id) return;
    if (!porTipo.has(registro.alvo_tipo)) porTipo.set(registro.alvo_tipo, new Set());
    porTipo.get(registro.alvo_tipo).add(registro.alvo_id);
  });

  const mapa = new Map();

  await Promise.all(
    [...porTipo.entries()].map(async ([tipo, ids]) => {
      const fonte = FONTES[tipo];
      const linhas = await fonte.model().findAll({
        where: { id: { [Op.in]: [...ids] } },
        attributes: fonte.attributes,
        /* `paranoid: false`: denúncia sobre anúncio já removido continua sendo
           o caso mais comum da fila — sumir com o alvo tiraria do moderador
           justamente o que ele precisa ver para julgar */
        paranoid: false,
        raw: true,
      });

      linhas.forEach((item) => mapa.set(`${tipo}:${item.id}`, item));
    })
  );

  return mapa;
}

// ─── CASOS DE USO ───────────────────────────────────────────────

/**
 * Fila de denúncias, priorizada.
 *
 * A ordenação padrão é a da feature (mais denúncias no mesmo alvo primeiro,
 * empate desempata pela mais antiga) — cinco pessoas denunciando o mesmo
 * anúncio é caso mais urgente que cinco anúncios com uma denúncia cada. Quando
 * o Admin escolhe `ordenarPor`, a ordem explícita vence a prioridade: é ele
 * dizendo que quer olhar por outro critério.
 */
async function listar(contexto, query = {}) {
  consultaService.exigirEscopoDeModeracao(contexto);

  const filtros = lerFiltros(query, { camposOrdenacao: ORDENAVEIS, ordemPadrao: 'criado_em' });

  const where = {};
  if (query.status) where.status = query.status;
  if (query.alvoTipo) where.alvo_tipo = query.alvoTipo;
  if (query.motivo) where.motivo = query.motivo;
  if (query.denunciadoId) where.denunciado_id = query.denunciadoId;
  if (query.semResponsavel) where.resolvida_por = null;
  if (filtros.periodo) {
    where.criado_em = { [Op.gte]: filtros.periodo.inicio, [Op.lte]: filtros.periodo.fim };
  }

  const ordemExplicita = Boolean(query.ordenarPor);

  const { rows, count } = await db.Denuncia.findAndCountAll({
    where,
    attributes: { include: [[consultaService.PRIORIDADE, 'denuncias_no_alvo']] },
    include: [DENUNCIADO()],
    order: ordemExplicita
      ? filtros.ordem
      : [[consultaService.PRIORIDADE, 'DESC'], ['criado_em', 'ASC']],
    limit: filtros.limit,
    offset: filtros.offset,
    /* includes são todos para-um: sem subconsulta, o LIMIT vale direto e a
       contagem não duplica linha */
    subQuery: false,
    distinct: true,
  });

  const alvos = await carregarAlvos(rows);

  return {
    itens: rows.map((registro) => linha(registro, alvos)),
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    total: count,
  };
}

/**
 * Agrupamento por alvo — "o que está pegando fogo".
 *
 * Delegado inteiro à feature, que faz `GROUP BY` no banco. Reagrupar aqui em
 * JavaScript funcionaria até a tabela crescer, e quebraria exatamente no dia em
 * que a moderação passasse a importar.
 */
async function agrupadas(contexto, query = {}) {
  const { itens, pagina, porPagina, total } = await consultaService.agrupadasPorAlvo(
    contexto,
    query
  );

  const alvos = await carregarAlvos(
    itens.map((grupo) => ({ alvo_tipo: grupo.alvo_tipo, alvo_id: grupo.alvo_id }))
  );

  return {
    itens: itens.map((grupo) => ({
      ...denunciaMapper.grupo(grupo),
      alvo: alvo(grupo.alvo_tipo, alvos.get(`${grupo.alvo_tipo}:${grupo.alvo_id}`)),
    })),
    pagina,
    porPagina,
    total,
  };
}

/**
 * Detalhe da denúncia.
 *
 * `consultaService.ver` já grava em `logs_acesso_dado` a abertura da ficha do
 * denunciado (LGPD: leitura também é evento). O que ele NÃO grava é a linha de
 * auditoria da consulta administrativa — e é ela que responde "quem andou
 * abrindo denúncias no painel", pergunta diferente de "quem leu dado do
 * fulano". As duas trilhas se complementam.
 */
async function ver(contexto, id) {
  const { denuncia, podeVerDenunciante, daModeracao } = await consultaService.ver(contexto, id);

  const alvos = await carregarAlvos([denuncia]);
  const base = podeVerDenunciante
    ? denunciaMapper.itemComDenunciante(denuncia)
    : denunciaMapper.item(denuncia);

  await registrarAcao(contexto, {
    acao: 'consultar',
    entidade: ENTIDADE,
    entidadeId: denuncia.id,
    motivo: 'abertura de denúncia no painel',
    depois: { alvoTipo: denuncia.alvo_tipo, alvoId: denuncia.alvo_id },
  });

  const completo = await db.Usuario.findByPk(denuncia.denunciado_id, {
    attributes: DENUNCIADO().attributes,
    include: DENUNCIADO().include,
  });

  return {
    ...base,
    daModeracao,
    denunciado: denunciado(completo),
    alvo: alvo(denuncia.alvo_tipo, alvos.get(`${denuncia.alvo_tipo}:${denuncia.alvo_id}`)),
  };
}

/**
 * Veredito.
 *
 * Delegação pura. Resolver é registro de decisão: a punição (ocultar anúncio,
 * suspender conta) é ação da feature `moderacao`, com permissão própria — e é
 * essa separação que impede "arquivar uma denúncia" de virar atalho para banir
 * alguém sem passar por `usuario.banir`.
 *
 * A auditoria da resolução é gravada pela própria feature, com o texto da
 * decisão como motivo; duplicar aqui só encheria a trilha com duas linhas para
 * o mesmo fato.
 */
async function resolver(contexto, id, dados) {
  const denuncia = await resolucaoService.resolver(contexto, id, dados);

  /* o card de pendências do painel conta denúncias abertas */
  await invalidarPainel();

  return denunciaMapper.item(denuncia);
}

module.exports = { listar, agrupadas, ver, resolver };
