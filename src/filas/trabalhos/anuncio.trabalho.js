'use strict';

const { Op } = require('sequelize');
const { registrar } = require('../registro');
const { FILAS } = require('../definicoes');

/**
 * Trabalhos do domínio `anuncio.*`.
 *
 * Tudo aqui existe para tirar peso do caminho da resposta. Três naturezas:
 *
 *  · **reindexar** — recalcular `busca_texto` e `titulo_normalizado` é
 *    concatenar e normalizar quatro campos e reescrever a linha. Barato, mas
 *    não é trabalho que o usuário deva esperar ao salvar o anúncio.
 *  · **registrarVisualizacao / registrarContato** — contadores. Escrever a
 *    mesma linha a cada visita serializa o anúncio popular no exato momento em
 *    que ele não pode ficar lento.
 *  · **expirar** — rotina periódica que tira da vitrine o que venceu.
 *
 * `db` é carregado dentro do executor, e não no topo: o worker sobe sem
 * precisar do modelo inteiro em memória enquanto não houver job.
 */

/**
 * Recalcula os campos derivados de busca.
 *
 * Sem anúncio informado, varre em lote — é o que se roda depois de mexer no
 * normalizador ou de importar dado antigo.
 */
const REINDEXAR = registrar(
  'anuncio.reindexar',
  async ({ anuncioId, lote = 200 } = {}) => {
    const db = require('../../models');
    const { normalizar } = require('../../utils/texto');

    const where = anuncioId ? { id: anuncioId } : { busca_texto: null };

    const anuncios = await db.Anuncio.findAll({
      where,
      include: [
        { model: db.Marca, as: 'marca', attributes: ['nome'] },
        { model: db.Categoria, as: 'categoria', attributes: ['nome'] },
      ],
      limit: anuncioId ? 1 : lote,
    });

    for (const anuncio of anuncios) {
      const partes = [
        anuncio.titulo,
        anuncio.descricao,
        anuncio.codigo_peca,
        anuncio.marca?.nome,
        anuncio.categoria?.nome,
      ].filter(Boolean);

      await anuncio.update({
        titulo_normalizado: normalizar(anuncio.titulo).slice(0, 160),
        codigo_peca_normalizado: anuncio.codigo_peca ? normalizar(anuncio.codigo_peca) : null,
        /* o índice trigram (`idx_anuncios_busca_trgm`) trabalha em cima desta
           coluna: gravar acentuado aqui faria a busca por "hidraulica" não
           achar "hidráulica" mesmo com o índice presente */
        busca_texto: normalizar(partes.join(' ')).slice(0, 20000),
      });
    }

    return { reindexados: anuncios.length };
  },
  { fila: FILAS.INDEXACAO.nome }
);

/** upsert atômico do agregado diário — `ON CONFLICT` evita ler antes de escrever */
async function somarNaMetrica(db, anuncioId, data, colunas) {
  const campos = Object.keys(colunas);
  const valores = campos.map((campo) => Number(colunas[campo]) || 0);

  await db.sequelize.query(
    `INSERT INTO anuncio_metricas_diarias (id, anuncio_id, data, ${campos.join(', ')}, criado_em, atualizado_em)
     VALUES (gen_random_uuid(), :anuncioId, :data, ${valores.join(', ')}, NOW(), NOW())
     ON CONFLICT (anuncio_id, data) DO UPDATE SET
       ${campos.map((campo, i) => `${campo} = anuncio_metricas_diarias.${campo} + ${valores[i]}`).join(', ')},
       atualizado_em = NOW()`,
    { replacements: { anuncioId, data } }
  );
}

const REGISTRAR_VISUALIZACAO = registrar(
  'anuncio.registrarVisualizacao',
  async ({ anuncioId, data, unica = true }) => {
    const db = require('../../models');
    const dia = data || new Date().toISOString().slice(0, 10);

    await somarNaMetrica(db, anuncioId, dia, {
      visualizacoes: 1,
      visualizacoes_unicas: unica ? 1 : 0,
    });

    /* `increment` vira `SET col = col + 1` no banco: duas visitas simultâneas
       não se sobrescrevem, o que aconteceria com ler-somar-gravar */
    await db.Anuncio.increment({ total_visualizacoes: 1 }, { where: { id: anuncioId } });

    return { anuncioId, dia };
  },
  { fila: FILAS.INDEXACAO.nome }
);

const REGISTRAR_CONTATO = registrar(
  'anuncio.registrarContato',
  async ({ anuncioId, canal, data }) => {
    const db = require('../../models');
    const dia = data || new Date().toISOString().slice(0, 10);

    const porCanal = {
      whatsapp: { metrica: 'cliques_whatsapp', coluna: 'total_contatos_whatsapp' },
      chat: { metrica: 'conversas_iniciadas', coluna: 'total_contatos_chat' },
    };
    const alvo = porCanal[canal];
    if (!alvo) return { ignorado: canal };

    await somarNaMetrica(db, anuncioId, dia, { [alvo.metrica]: 1 });
    await db.Anuncio.increment({ [alvo.coluna]: 1 }, { where: { id: anuncioId } });

    /* o total do perfil alimenta a página do anunciante; falhar aqui não pode
       desfazer o contato, que já está gravado em `anuncio_contatos` */
    const anuncio = await db.Anuncio.findByPk(anuncioId, { attributes: ['perfil_id'] });
    if (anuncio?.perfil_id) {
      await db.Perfil.increment({ total_contatos: 1 }, { where: { id: anuncio.perfil_id } });
    }

    return { anuncioId, canal };
  },
  { fila: FILAS.INDEXACAO.nome }
);

/**
 * Expira o que venceu.
 *
 * O anúncio não é apagado nem escondido do dono: vira `expirado` e continua em
 * "Meus anúncios" com o botão de renovar. Sumir com o trabalho de quem
 * cadastrou 20 peças seria perder o usuário junto.
 *
 * `UPDATE ... WHERE` em lote, nunca laço de `save()`: em safra são milhares de
 * linhas de uma vez.
 */
const EXPIRAR = registrar(
  'anuncio.expirar',
  async ({ lote = 1000 } = {}) => {
    const db = require('../../models');
    const cache = require('../../cache');
    const filas = require('../index');
    const { chaves } = require('../../features/anuncio/anuncio.cache');

    const vencidos = await db.Anuncio.findAll({
      where: { status: 'publicado', expira_em: { [Op.lt]: new Date() } },
      attributes: ['id', 'usuario_id', 'perfil_id', 'titulo'],
      limit: lote,
    });

    if (!vencidos.length) return { expirados: 0 };

    const ids = vencidos.map((anuncio) => anuncio.id);

    await db.sequelize.transaction(async (transacao) => {
      await db.Anuncio.update(
        { status: 'expirado' },
        { where: { id: { [Op.in]: ids } }, transaction: transacao }
      );

      await db.AnuncioHistorico.bulkCreate(
        vencidos.map((anuncio) => ({
          anuncio_id: anuncio.id,
          status_anterior: 'publicado',
          status_novo: 'expirado',
          ator_id: null,
          ator_papel: 'sistema',
          motivo: 'prazo de validade encerrado',
        })),
        { transaction: transacao }
      );

      /* o contador de ativos do perfil precisa cair junto — 'expirado' não é
         status ativo, e a página do anunciante mostraria número inflado */
      for (const anuncio of vencidos) {
        await db.Perfil.increment(
          { total_anuncios_ativos: -1 },
          { where: { id: anuncio.perfil_id }, transaction: transacao }
        );
      }
    });

    for (const anuncio of vencidos) {
      await filas.enfileirar('notificacao.criar', {
        usuarioId: anuncio.usuario_id,
        tipo: 'anuncio_expirado',
        titulo: 'Seu anúncio expirou',
        mensagem: `O anúncio "${anuncio.titulo}" saiu do ar. Renove para voltar à vitrine.`,
        dados: { anuncioId: anuncio.id },
        entidade: 'anuncios',
        entidadeId: anuncio.id,
        canais: ['sistema'],
      });
      await cache.remover(chaves.detalhe(anuncio.id));
    }

    await cache.invalidar(chaves.dominioListas());

    return { expirados: ids.length };
  },
  { fila: FILAS.MANUTENCAO.nome }
);

module.exports = { REINDEXAR, REGISTRAR_VISUALIZACAO, REGISTRAR_CONTATO, EXPIRAR };
