'use strict';

const db = require('../../models');
const { CANAL } = require('./contato.constants');
const consulta = require('./contato.consulta.service');

/**
 * Métricas de contato: a leitura agregada e a agregação em si.
 *
 * A divisão que importa aqui é entre **ler** (rota, síncrono, barato) e
 * **agregar** (job, assíncrono, caro). A agregação vive neste arquivo porque é
 * a mesma regra de negócio, mas é chamada de `filas/trabalhos/contato.trabalho.js`
 * — nunca do caminho da resposta.
 */

/**
 * Série diária de contatos de um anúncio.
 *
 * Lê `anuncio_metricas_diarias`, que já tem uma linha por anúncio/dia, em vez
 * de agrupar `anuncio_contatos` por data a cada abertura do painel. A tabela de
 * eventos cresce sem limite; a de agregado não.
 *
 * O preço é a defasagem do job — assumida e declarada na resposta em
 * `atualizadoEm`, para que a tela possa dizer "até ontem" em vez de sugerir
 * tempo real que não existe.
 */
async function porAnuncio(contexto, anuncioId, { desde, ate } = {}) {
  const anuncio = await consulta.exigirDono(contexto, anuncioId, 'anuncio.ver_metricas');

  const onde = { anuncio_id: anuncio.id };
  if (desde || ate) {
    onde.data = {};
    if (desde) onde.data[db.Sequelize.Op.gte] = desde;
    if (ate) onde.data[db.Sequelize.Op.lte] = ate;
  }

  const linhas = await db.AnuncioMetricaDiaria.findAll({
    where: onde,
    attributes: ['data', 'visualizacoes', 'cliques_whatsapp', 'conversas_iniciadas', 'favoritos'],
    order: [['data', 'ASC']],
    raw: true,
  });

  const somar = (campo) => linhas.reduce((total, linha) => total + (linha[campo] || 0), 0);

  return {
    anuncioId: anuncio.id,
    serie: linhas,
    totais: {
      visualizacoes: somar('visualizacoes'),
      contatosWhatsapp: somar('cliques_whatsapp'),
      conversas: somar('conversas_iniciadas'),
      favoritos: somar('favoritos'),
      /* soma da série no período pedido; os contadores da tabela `anuncios`
         são o acumulado de todos os tempos e respondem outra pergunta */
      contatos: somar('cliques_whatsapp') + somar('conversas_iniciadas'),
    },
    atualizadoEm: linhas.length ? linhas[linhas.length - 1].data : null,
  };
}

/** intervalo do dia informado (ou de hoje), em horário do servidor */
function limitesDoDia(dataIso) {
  const dia = dataIso ? new Date(`${dataIso}T00:00:00`) : new Date();
  const inicio = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate());
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
  return { inicio, fim, data: inicio.toISOString().slice(0, 10) };
}

/**
 * Agrega os contatos de um dia em `anuncio_metricas_diarias`.
 *
 * Chamado pelo job. Recalcula o dia inteiro a partir de `anuncio_contatos` em
 * vez de somar o delta: recontar é **idempotente**, e um job que soma delta
 * duplica tudo na primeira retentativa — que o BullMQ faz sozinho, sem avisar
 * ninguém.
 *
 * Um `GROUP BY` só, não uma consulta por anúncio. Quando `anuncioId` vem
 * informado, o recorte é daquele anúncio (o caminho quente, disparado pelo
 * próprio registro do contato); sem ele, o dia inteiro da plataforma.
 */
async function agregarDia({ anuncioId, data } = {}) {
  const { inicio, fim, data: dia } = limitesDoDia(data);

  const onde = { criado_em: { [db.Sequelize.Op.gte]: inicio, [db.Sequelize.Op.lt]: fim } };
  if (anuncioId) onde.anuncio_id = anuncioId;

  const linhas = await db.AnuncioContato.findAll({
    where: onde,
    attributes: [
      'anuncio_id',
      'canal',
      [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'total'],
    ],
    group: ['anuncio_id', 'canal'],
    raw: true,
  });

  const porAnuncioId = new Map();
  linhas.forEach((linha) => {
    const atual = porAnuncioId.get(linha.anuncio_id) || { whatsapp: 0, chat: 0 };
    const total = Number(linha.total) || 0;

    if (linha.canal === CANAL.CHAT) atual.chat += total;
    else atual.whatsapp += total; // whatsapp, telefone e e-mail contam como clique de contato
    porAnuncioId.set(linha.anuncio_id, atual);
  });

  let gravadas = 0;

  for (const [id, totais] of porAnuncioId) {
    const [registro] = await db.AnuncioMetricaDiaria.findOrCreate({
      where: { anuncio_id: id, data: dia },
      defaults: { anuncio_id: id, data: dia },
    });

    await registro.update({
      cliques_whatsapp: totais.whatsapp,
      conversas_iniciadas: totais.chat,
    });

    gravadas += 1;
  }

  return { data: dia, anuncios: gravadas };
}

/**
 * Recalcula `perfis.total_contatos`.
 *
 * Contador é coluna (padrão §10.4), mas este em particular é **recalculado**,
 * não incrementado: ele é o número que aparece no perfil público ("já foi
 * procurado 340 vezes") e um contador incremental que erra uma vez erra para
 * sempre. Recontar uma vez por dia, num job, custa um `COUNT` por perfil ativo
 * e devolve a garantia de que o número bate com a tabela.
 *
 * Só recalcula os perfis que tiveram movimento no período — varrer a base
 * inteira todo dia seria pagar por milhares de perfis parados.
 */
async function recalcularTotaisDePerfil({ desde } = {}) {
  const corte = desde || new Date(Date.now() - 24 * 60 * 60 * 1000);

  const anunciantes = await db.AnuncioContato.findAll({
    where: { criado_em: { [db.Sequelize.Op.gte]: corte } },
    attributes: ['anunciante_id'],
    group: ['anunciante_id'],
    raw: true,
  });

  let atualizados = 0;

  for (const { anunciante_id: usuarioId } of anunciantes) {
    const total = await db.AnuncioContato.count({ where: { anunciante_id: usuarioId } });
    const [afetados] = await db.Perfil.update(
      { total_contatos: total },
      { where: { usuario_id: usuarioId } }
    );
    atualizados += afetados;
  }

  return { perfis: atualizados };
}

module.exports = { porAnuncio, agregarDia, recalcularTotaisDePerfil, limitesDoDia };
