'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const filas = require('../../filas');
const { erros } = require('../../utils/erros');
const { lerPaginacao } = require('../../utils/paginacao');
const acesso = require('./anuncio.acesso.service');
const { chaves } = require('./anuncio.cache');
const { TRABALHOS, JANELA_VISUALIZACAO_SEGUNDOS } = require('./anuncio.constants');

/**
 * Métricas do anúncio: visualização, contato e o painel do anunciante.
 *
 * A regra que define o arquivo: **nada de `UPDATE` síncrono a cada visita.**
 * Um incremento por acesso serializa a mesma linha para todo mundo que abre o
 * anúncio — na hora em que ele bomba, que é justamente quando não pode cair, o
 * banco vira fila de bloqueio. Aqui a visita só é contabilizada depois de
 * passar por dois filtros baratos:
 *
 *   1. **Janela por IP hash + anúncio**, no cache. F5 não vira métrica; sem
 *      isso o anunciante tomaria decisão comercial em cima de ruído, e um
 *      script inflaria o número do próprio anúncio em minutos.
 *   2. **Fila.** O agregado diário e o contador da coluna são escritos pelo
 *      worker, fora do caminho da resposta.
 *
 * O IP nunca é guardado em claro — a janela usa o hash que o contexto já traz
 * (LGPD, e é o mesmo hash de `logs_auditoria`).
 */

async function registrarVisualizacao(contexto, anuncioId) {
  const identificador = contexto?.ipHash || 'anonimo';
  const contagem = await cache.incrementar(chaves.visita(anuncioId, identificador), {
    ttl: JANELA_VISUALIZACAO_SEGUNDOS,
  });

  /* contagem 0 = cache fora do ar. Conta assim mesmo: perder a proteção
     antiflood é melhor do que perder a métrica inteira enquanto o Redis volta */
  if (contagem > 1) return { contabilizada: false };

  await filas.enfileirar(TRABALHOS.REGISTRAR_VISUALIZACAO, {
    anuncioId,
    unica: true,
    data: new Date().toISOString().slice(0, 10),
  });

  return { contabilizada: true };
}

/**
 * Clique em "chamar no WhatsApp" ou início de conversa.
 *
 * Fica gravado em `anuncio_contatos` na hora (é o registro do fato, e o
 * anunciante precisa ver quem o procurou mesmo que a conversa tenha ido para o
 * WhatsApp e nunca voltado). Só o CONTADOR vai para a fila.
 *
 * Não exige login: o botão do WhatsApp funciona para visitante, porque ele não
 * depende de conta nenhuma (Maturacao/05, §8.2.2).
 */
async function registrarContato(contexto, anuncioId, { canal, origem } = {}) {
  const anuncio = await db.Anuncio.findOne({
    where: { id: anuncioId, status: 'publicado' },
    attributes: ['id', 'usuario_id'],
  });

  /* anúncio fora do ar não gera contato — e responde igual a id inexistente */
  if (!anuncio) throw erros.naoEncontrado('Anúncio');

  await db.AnuncioContato.create({
    anuncio_id: anuncio.id,
    anunciante_id: anuncio.usuario_id,
    interessado_id: contexto?.usuarioId || null,
    canal,
    origem: origem || 'detalhe',
    ip_hash: contexto?.ipHash || null,
    user_agent: contexto?.userAgent || null,
  });

  await filas.enfileirar(TRABALHOS.REGISTRAR_CONTATO, {
    anuncioId: anuncio.id,
    canal,
    data: new Date().toISOString().slice(0, 10),
  });

  return { registrado: true };
}

/**
 * Painel do anunciante: série diária + totais.
 *
 * Os totais saem das COLUNAS do anúncio, não de um `SUM` na série — o número
 * grande da tela não pode custar uma varredura de meses de métrica a cada
 * abertura.
 */
async function resumo(contexto, id, { dias = 30 } = {}) {
  const anuncio = await acesso.paraAcao(contexto, id, 'anuncio.ver_metricas');

  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  const serie = await db.AnuncioMetricaDiaria.findAll({
    where: { anuncio_id: anuncio.id, data: { [Op.gte]: desde.toISOString().slice(0, 10) } },
    order: [['data', 'ASC']],
  });

  return {
    anuncioId: anuncio.id,
    periodoDias: dias,
    totais: {
      visualizacoes: anuncio.total_visualizacoes,
      contatosWhatsapp: anuncio.total_contatos_whatsapp,
      contatosChat: anuncio.total_contatos_chat,
      favoritos: anuncio.total_favoritos,
    },
    serie,
  };
}

/** quem procurou o anunciante — exige `anuncio.ver_contatos` */
async function contatos(contexto, id, consulta = {}) {
  const anuncio = await acesso.paraAcao(contexto, id, 'anuncio.ver_contatos');
  const { pagina, porPagina, offset, limit } = lerPaginacao(consulta);

  const { rows, count } = await db.AnuncioContato.findAndCountAll({
    where: { anuncio_id: anuncio.id },
    include: [{ model: db.Usuario, as: 'interessado', attributes: ['id', 'nome'] }],
    attributes: ['id', 'canal', 'origem', 'conversa_id', 'criado_em'],
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

module.exports = { registrarVisualizacao, registrarContato, resumo, contatos };
