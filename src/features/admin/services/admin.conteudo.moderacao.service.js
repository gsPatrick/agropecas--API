'use strict';

const { Op } = require('sequelize');
const db = require('../../../models');
const filas = require('../../../filas');
const cache = require('../../../cache');
const { exigir } = require('../../../rbac');
const { erros } = require('../../../utils/erros');

const filaService = require('../../moderacao/moderacao.fila.service');
const anuncioModeracao = require('../../moderacao/moderacao.anuncio.service');
const conteudoModeracao = require('../../moderacao/moderacao.conteudo.service');
const moderacaoMapper = require('../../moderacao/moderacao.mapper');
const { chaves: chavesModeracao } = require('../../moderacao/moderacao.cache');
const { exigirMotivo } = require('../../moderacao/moderacao.comum');
const campos = require('../../anuncio/anuncio.campos');
const anunciosService = require('./admin.conteudo.anuncios.service');

const { registrarAcao, registrarLote } = require('../helpers/admin.auditoria.helper');
const { garantirLote } = require('../helpers/admin.contexto.helper');
const { lerFiltros } = require('../helpers/admin.consulta.helper');
const compartilhado = require('./admin.shared');

/**
 * A mesa de moderação dentro do painel.
 *
 * O veredito continua sendo o da feature `moderacao`: aprovar é
 * `moderacao.anuncio.service.aprovar`, ocultar é
 * `moderacao.conteudo.service.ocultar`. Este arquivo não decide nada sobre
 * conteúdo — ele **agrupa a tarefa**, que é o que o módulo `admin` existe para
 * fazer.
 *
 * Duas coisas só existem aqui, porque nenhuma feature poderia tê-las:
 *
 *  1. **a fila com capa** — a linha do painel mostra a imagem, e a feature de
 *     moderação não conhece a galeria do anúncio;
 *  2. **o lote** — decidir sobre trinta anúncios de uma vez, com teto e com
 *     UMA linha de auditoria contendo a lista. Trinta linhas idênticas na
 *     trilha transformariam em ruído justamente o evento que mais importa
 *     revisar depois.
 *
 * `destacar` também mora aqui, e é o único caso em que este módulo escreve no
 * anúncio direto: destaque é decisão comercial do painel, não moderação, e não
 * existe service de feature para ele.
 */

/** prazo do destaque quando ninguém pede outro — uma semana de vitrine */
const DESTAQUE_DIAS_PADRAO = 7;
/** teto: destaque "para sempre" é o mesmo que não ter destaque nenhum */
const DESTAQUE_DIAS_MAXIMO = 90;
/**
 * Teto do lote — o mesmo de `garantirLote` e do esquema de entrada.
 *
 * Os três precisam concordar: se o validador aceitasse mais do que o service,
 * o operador receberia 400 depois de montar uma seleção de 200 itens; se
 * aceitasse menos, o teto do service nunca seria exercido e um dia alguém o
 * removeria por parecer morto.
 */
const LOTE_MAXIMO = 100;

/**
 * O que o lote sabe fazer.
 *
 * Cada entrada delega para o mesmo service que a ação unitária usa — é isto
 * que garante que "reprovar 30" aplique exatamente a regra de "reprovar 1",
 * inclusive histórico, notificação e recusa de moderar a si mesmo.
 */
const ACOES_LOTE = {
  aprovar: (contexto, id, motivo) => anuncioModeracao.aprovar(contexto, id, { observacao: motivo }),
  reprovar: (contexto, id, motivo) => anuncioModeracao.reprovar(contexto, id, { motivo }),
  ocultar: (contexto, id, motivo) => conteudoModeracao.ocultar(contexto, id, { motivo }),
  remover: (contexto, id, motivo) => anunciosService.remover(contexto, id, { motivo }),
};

/**
 * A fila de trabalho.
 *
 * A consulta pesada (anúncio + dono + contagem de denúncias abertas agregada
 * no banco) é a de `moderacao.fila.service` — reescrevê-la aqui seria manter
 * dois SQLs para a mesma pergunta. A capa vem numa **segunda consulta em
 * lote**, com todos os ids de uma vez: buscar a foto dentro do laço seria o
 * N+1 clássico de 21 consultas por tela.
 */
async function fila(contexto, query = {}) {
  const filtros = lerFiltros(query);

  const { itens, pagina, porPagina, total } = await filaService.listar(contexto, {
    ...query,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
  });

  const linhas = moderacaoMapper.fila(itens);
  const capas = await capasDe(linhas.map((item) => item.id));

  return {
    itens: linhas.map((item) => ({ ...item, capa: capas.get(String(item.id)) || null })),
    pagina,
    porPagina,
    total,
  };
}

/** uma consulta para a página inteira, indexada por anúncio */
async function capasDe(ids = []) {
  const mapa = new Map();
  if (!ids.length) return mapa;

  const fotos = await db.AnuncioFoto.findAll({
    where: { anuncio_id: { [Op.in]: ids }, principal: true, bloqueada: false },
    attributes: ['id', 'anuncio_id', 'url', 'url_thumb'],
  });

  fotos.forEach((foto) => {
    mapa.set(String(foto.anuncio_id), { id: foto.id, url: foto.url, urlThumb: foto.url_thumb });
  });

  return mapa;
}

/* ─── veredito unitário: tudo delegado, nada reimplementado ─────────── */

const aprovar = async (contexto, id, { observacao } = {}) =>
  moderacaoMapper.decisao(await anuncioModeracao.aprovar(contexto, id, { observacao }));

const reprovar = async (contexto, id, { motivo } = {}) =>
  /* o motivo é exigido no service da feature (`exigirMotivo`, 422): repetir a
     checagem aqui criaria duas mensagens diferentes para a mesma recusa */
  moderacaoMapper.decisao(await anuncioModeracao.reprovar(contexto, id, { motivo }));

const ocultar = async (contexto, id, { motivo } = {}) =>
  moderacaoMapper.decisao(await conteudoModeracao.ocultar(contexto, id, { motivo }));

/**
 * Destaque na vitrine.
 *
 * O model guarda `destaque_ate` e não um booleano, e a diferença é o produto
 * inteiro: destaque sem prazo nunca sai sozinho e, meses depois, a home mostra
 * um trator vendido em janeiro porque ninguém lembrou de desmarcar. O prazo
 * padrão é de uma semana; `dias: 0` (ou `destacar: false`) retira.
 */
async function destacar(contexto, id, { ateEm, destacar: ligar = true, motivo } = {}) {
  const anuncio = await db.Anuncio.findByPk(id, {
    attributes: ['id', 'codigo', 'titulo', 'status', 'usuario_id', 'destaque_ate'],
  });
  if (!anuncio) throw erros.naoEncontrado('Anúncio');

  exigir(contexto, 'anuncio.destacar', { donoId: anuncio.usuario_id });

  const retirar = ligar === false;

  /* `ateEm` é opcional; sem ele valem os sete dias padrão. O teto de noventa
     dias é aplicado mesmo quando a data vem do corpo: destaque "até 2099" é o
     mesmo que destaque sem prazo, e é assim que a home fica com um trator
     vendido em janeiro */
  const limite = new Date(Date.now() + DESTAQUE_DIAS_MAXIMO * 24 * 60 * 60 * 1000);
  const padrao = new Date(Date.now() + DESTAQUE_DIAS_PADRAO * 24 * 60 * 60 * 1000);
  const pedido = ateEm ? new Date(ateEm) : padrao;

  if (!retirar && pedido.getTime() <= Date.now()) {
    throw erros.validacao({ ateEm: 'O fim do destaque precisa ser no futuro.' });
  }

  const prazo = new Date(Math.min(pedido.getTime(), limite.getTime()));

  /* destacar o que não está no ar seria pagar posição de vitrine para um
     anúncio que a vitrine não mostra */
  if (!retirar && anuncio.status !== 'publicado') {
    throw erros.conflito('Só anúncio publicado pode ir para o destaque.', { status: anuncio.status });
  }

  const antes = { destaque_ate: anuncio.destaque_ate };
  const destaqueAte = retirar ? null : prazo;

  await anuncio.update({ destaque_ate: destaqueAte });

  await registrarAcao(contexto, {
    acao: 'editar',
    entidade: 'anuncios',
    entidadeId: anuncio.id,
    emNomeDe: anuncio.usuario_id,
    motivo: motivo || (retirar ? 'destaque_retirado' : 'destaque_concedido'),
    antes,
    depois: { destaque_ate: destaqueAte },
  });

  if (!retirar) {
    await filas.enfileirar('notificacao.criar', {
      usuarioId: anuncio.usuario_id,
      tipo: 'sistema',
      titulo: 'Seu anúncio está em destaque',
      mensagem: `O anúncio "${anuncio.titulo}" ficará em destaque até ${destaqueAte.toLocaleDateString('pt-BR')}.`,
      dados: { anuncioId: anuncio.id, destaqueAte },
      entidade: 'anuncios',
      entidadeId: anuncio.id,
      canais: ['sistema'],
    });
  }

  await campos.invalidar(anuncio.id);

  return { id: anuncio.id, codigo: anuncio.codigo, destaque: !retirar, destaqueAte };
}

/**
 * Aprovar ou reprovar vários de uma vez.
 *
 * Roda em SÉRIE de propósito. Em paralelo, trinta transações concorrentes
 * disputariam o mesmo pool de conexões e um erro no meio deixaria metade
 * aplicada sem que se soubesse qual metade. Aqui cada item tem resultado
 * próprio e a resposta diz exatamente o que passou e o que não passou — é o
 * que o moderador precisa para reprocessar só o resto.
 *
 * A trilha recebe **uma** linha com a lista inteira (`registrarLote`); as
 * linhas individuais que os services da feature já gravam continuam existindo
 * para quem investiga um anúncio específico.
 */
async function moderarEmLote(contexto, { ids = [], acao, decisao, motivo } = {}) {
  const escolha = acao || decisao;

  if (!Array.isArray(ids) || !ids.length) {
    throw erros.validacao({ ids: 'Informe ao menos um anúncio.' });
  }
  if (!ACOES_LOTE[escolha]) {
    throw erros.validacao({ acao: `Ação inválida — use ${Object.keys(ACOES_LOTE).join(', ')}.` });
  }

  /* exige `admin.operar_em_lote` E aplica o teto: acima dele o erro é 400,
     antes de qualquer escrita — meio lote aplicado é pior que nenhum */
  garantirLote(contexto, ids.length, LOTE_MAXIMO);

  /* nenhuma ação em massa passa sem justificativa: mesmo aprovar em lote é
     decisão, e é este texto que responde "por que trinta de uma vez?" */
  const justificativa = exigirMotivo(motivo);

  /* ids repetidos custariam duas transações e duas notificações pelo mesmo
     anúncio, com a segunda falhando por conflito de estado */
  const unicos = [...new Set(ids.map(String))];

  const resultado = { aplicados: [], falhas: [] };

  for (const id of unicos) {
    try {
      await ACOES_LOTE[escolha](contexto, id, justificativa);
      resultado.aplicados.push(id);
    } catch (erro) {
      /* uma falha não aborta o lote: quase sempre é um anúncio que outro
         moderador já decidiu, e desfazer os vinte anteriores por causa dele
         seria trocar um problema pequeno por um grande */
      resultado.falhas.push({ id, motivo: erro.message, codigo: erro.code || 'ERRO' });
    }
  }

  await registrarLote(contexto, {
    acao: escolha,
    entidade: 'anuncios',
    ids: resultado.aplicados,
    motivo: justificativa,
    resultado: { aplicados: resultado.aplicados.length, falhas: resultado.falhas.length },
  });

  await cache.remover(chavesModeracao.painel());
  await compartilhado.invalidarPainel();

  return {
    acao: escolha,
    total: unicos.length,
    aplicados: resultado.aplicados.length,
    falhas: resultado.falhas,
  };
}

module.exports = {
  fila,
  aprovar,
  reprovar,
  ocultar,
  destacar,
  moderarEmLote,
  LOTE_MAXIMO,
  DESTAQUE_DIAS_PADRAO,
  DESTAQUE_DIAS_MAXIMO,
};
