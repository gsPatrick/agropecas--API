'use strict';

const { Op } = require('sequelize');
const db = require('../../../models');
const cache = require('../../../cache');
const { FILA_STATUS } = require('../../moderacao/moderacao.constants');
const { lerFiltros } = require('../helpers/admin.consulta.helper');
const compartilhado = require('./admin.shared');

/**
 * A primeira tela do painel: "o que aconteceu hoje" e "o que preciso resolver".
 *
 * A razão de existir do módulo `admin` está inteira aqui. As features já sabem
 * contar denúncia, anúncio e cadastro — o que nenhuma delas pode fazer é
 * cruzar os três numa tela só, porque isso faria `denuncia` conhecer `anuncio`
 * e `usuario`. A agregação mora aqui e as contagens continuam sendo pedidas a
 * quem é dono do assunto (`moderacao.painel.service` para a fila).
 *
 * Três decisões atravessam o arquivo:
 *
 * 1. **Cache curto por recorte de permissão.** Ver `admin.shared.js`. A chave
 *    inclui a assinatura das capacidades — sem isso, o resumo do Admin ficaria
 *    guardado e seria servido ao moderador com os cards que ele não pode ver.
 * 2. **As contagens rodam em paralelo.** São independentes; em série o painel
 *    custaria a soma dos tempos em vez do maior deles.
 * 3. **Só objeto simples vai para o cache** — nunca instância do Sequelize
 *    (PADRÃO_MODULO §7).
 */

/** anúncios que esperam decisão humana — mesmo critério da mesa de moderação */
const FILTRO_FILA = {
  moderacao_status: { [Op.in]: FILA_STATUS },
  status: { [Op.ne]: 'removido' },
};

/**
 * Resumo do dia.
 *
 * Cada bloco só é calculado para quem tem escopo total no recurso: o painel
 * não concede leitura que a feature negaria.
 */
async function resumo(contexto) {
  const cap = compartilhado.capacidades(contexto);
  const assinatura = compartilhado.assinaturaDeCapacidades(cap);

  return cache.lembrar(
    compartilhado.chaves.resumo(assinatura),
    async () => {
      const desde = compartilhado.hoje();
      const noDia = { criado_em: { [Op.gte]: desde } };

      /* `Promise.all` sobre uma lista montada dinamicamente: cada entrada é um
         card, e o card que o solicitante não pode ver nem vira consulta */
      const tarefas = [];
      const rotulos = [];
      const pedir = (nome, promessa) => {
        rotulos.push(nome);
        tarefas.push(promessa);
      };

      if (cap.usuarios) {
        pedir('usuariosNovos', db.Usuario.count({ where: noDia }));
        pedir('usuariosTotal', db.Usuario.count());
        pedir('usuariosSuspensos', db.Usuario.count({ where: { status: 'suspenso' } }));
      }

      if (cap.anuncios) {
        pedir('anunciosPublicados', db.Anuncio.count({ where: { publicado_em: { [Op.gte]: desde } } }));
        pedir('anunciosNaFila', db.Anuncio.count({ where: FILTRO_FILA }));
        pedir('anunciosAtivos', db.Anuncio.count({ where: { status: 'publicado' } }));
      }

      if (cap.denuncias) {
        pedir('denunciasAbertas', db.Denuncia.count({ where: { status: 'aberta' } }));
        pedir('denunciasNoDia', db.Denuncia.count({ where: noDia }));
      }

      if (cap.perfis) {
        pedir('perfisAguardandoVerificacao', db.Perfil.count({ where: { verificado_em: null } }));
      }

      if (cap.planos) {
        pedir('assinaturasAtivas', db.Assinatura.count({ where: { status: 'ativa' } }));
      }

      const valores = await Promise.all(tarefas);
      const contadores = rotulos.reduce(
        (acumulado, nome, indice) => ({ ...acumulado, [nome]: compartilhado.numero(valores[indice]) }),
        {}
      );

      return {
        dia: desde.toISOString().slice(0, 10),
        contadores,
        /* o front usa este número no badge do menu: um só, que é o que cabe
           dentro do ícone */
        totalPendencias:
          (contadores.denunciasAbertas || 0) + (contadores.anunciosNaFila || 0),
        calculadoEm: new Date().toISOString(),
      };
    },
    { ttl: compartilhado.TTL.RESUMO }
  );
}

/** idade em horas — a única "prioridade" que não depende de opinião */
const horasDesde = (data) => Math.floor((Date.now() - new Date(data).getTime()) / 3600000);

/**
 * Prioridade da pendência.
 *
 * Denúncia pesa mais que fila de anúncio porque atrás de uma denúncia há
 * sempre alguém esperando resposta; um anúncio parado incomoda um anunciante,
 * uma denúncia sem resposta incomoda a vítima e a plataforma. A idade entra
 * como desempate, não como critério principal — senão a fila de anúncios
 * antigos empurraria a denúncia de hoje para o fim.
 */
const prioridade = (peso, criadoEm) => peso * 100 + Math.min(horasDesde(criadoEm), 99);

/**
 * O que exige ação humana AGORA, já ordenado.
 *
 * Cada bloco traz no máximo `LIMITE_POR_BLOCO` linhas: a tela é uma fila de
 * trabalho, não um relatório, e quem tem quatrocentas denúncias abertas não
 * resolve nada abrindo as quatrocentas de uma vez.
 */
const LIMITE_POR_BLOCO = 10;

async function pendencias(contexto) {
  const cap = compartilhado.capacidades(contexto);
  const assinatura = compartilhado.assinaturaDeCapacidades(cap);

  return cache.lembrar(
    compartilhado.chaves.pendencias(assinatura),
    async () => {
      const [denuncias, fila, verificacoes, solicitacoes] = await Promise.all([
        cap.denuncias
          ? db.Denuncia.findAll({
              where: { status: { [Op.in]: ['aberta', 'em_analise'] } },
              attributes: ['id', 'alvo_tipo', 'alvo_id', 'motivo', 'status', 'criado_em'],
              /* denunciante em `include`, não em laço: dez linhas viraria dez
                 consultas extras e é exatamente o N+1 que a revisão rejeita */
              include: [{ model: db.Usuario, as: 'denunciante', attributes: ['id', 'nome'], required: false }],
              order: [['criado_em', 'ASC']],
              limit: LIMITE_POR_BLOCO,
            })
          : [],

        cap.anuncios
          ? db.Anuncio.findAll({
              where: FILTRO_FILA,
              attributes: ['id', 'codigo', 'titulo', 'moderacao_status', 'criado_em'],
              include: [{ model: db.Usuario, as: 'usuario', attributes: ['id', 'nome'], required: false }],
              order: [['criado_em', 'ASC']],
              limit: LIMITE_POR_BLOCO,
            })
          : [],

        cap.perfis
          ? db.Perfil.findAll({
              where: { verificado_em: null, tipo: { [Op.in]: ['loja', 'prestador'] } },
              /* lista branca: `bio` é TEXT e nenhuma fila de trabalho a usa */
              attributes: ['id', 'tipo', 'slug', 'nome_exibicao', 'uf', 'criado_em'],
              order: [['criado_em', 'ASC']],
              limit: LIMITE_POR_BLOCO,
            })
          : [],

        cap.lgpd
          ? db.SolicitacaoTitular.findAll({
              where: { status: { [Op.in]: ['aberta', 'em_atendimento'] } },
              attributes: ['id', 'tipo', 'status', 'prazo_em', 'criado_em'],
              order: [['criado_em', 'ASC']],
              limit: LIMITE_POR_BLOCO,
            })
          : [],
      ]);

      const itens = [
        ...denuncias.map((linha) => ({
          tipo: 'denuncia',
          id: linha.id,
          titulo: `Denúncia de ${linha.alvo_tipo}: ${linha.motivo}`,
          alvoId: linha.alvo_id,
          autor: linha.denunciante ? { id: linha.denunciante.id, nome: linha.denunciante.nome } : null,
          situacao: linha.status,
          criadoEm: linha.criado_em,
          horasParada: horasDesde(linha.criado_em),
          prioridade: prioridade(4, linha.criado_em),
        })),

        ...fila.map((linha) => ({
          tipo: 'anuncio',
          id: linha.id,
          titulo: linha.titulo,
          codigo: linha.codigo,
          autor: linha.usuario ? { id: linha.usuario.id, nome: linha.usuario.nome } : null,
          situacao: linha.moderacao_status,
          criadoEm: linha.criado_em,
          horasParada: horasDesde(linha.criado_em),
          prioridade: prioridade(3, linha.criado_em),
        })),

        ...solicitacoes.map((linha) => ({
          tipo: 'lgpd',
          id: linha.id,
          /* prazo legal: uma solicitação de titular vencida não é atraso, é
             descumprimento — por isso pesa mais que a fila de anúncios */
          titulo: `Solicitação LGPD (${linha.tipo})`,
          situacao: linha.status,
          prazoEm: linha.prazo_em,
          criadoEm: linha.criado_em,
          horasParada: horasDesde(linha.criado_em),
          prioridade: prioridade(5, linha.criado_em),
        })),

        ...verificacoes.map((linha) => ({
          tipo: 'perfil',
          id: linha.id,
          titulo: `Verificar ${linha.tipo}: ${linha.nome_exibicao}`,
          uf: linha.uf,
          situacao: 'nao_verificado',
          criadoEm: linha.criado_em,
          horasParada: horasDesde(linha.criado_em),
          prioridade: prioridade(1, linha.criado_em),
        })),
      ].sort((a, b) => b.prioridade - a.prioridade);

      return { itens, total: itens.length, calculadoEm: new Date().toISOString() };
    },
    { ttl: compartilhado.TTL.PENDENCIAS }
  );
}

/**
 * As últimas ações administrativas — o "quem mexeu no quê" da tela inicial.
 *
 * Não é cacheado, e é a única leitura do painel que não é: um Admin abre esta
 * lista logo depois de agir justamente para conferir se a ação ficou
 * registrada. Servir uma versão de 45 segundos atrás responderia "não ficou"
 * para algo que ficou.
 *
 * Só entram as ações de quem administra (`ator_papel` diferente de `usuario`) e
 * as que carregam representação: o resto da trilha é a atividade normal da
 * plataforma e tem tela própria em `/admin/auditoria`.
 */
async function atividadeAdministrativa(contexto, query = {}) {
  compartilhado.exigirEscopoTotal(
    contexto,
    'auditoria.ler',
    'Você não tem permissão para ver a trilha administrativa.'
  );

  const filtros = lerFiltros(query, { camposOrdenacao: ['criado_em'], ordemPadrao: 'criado_em' });

  const where = {
    [Op.or]: [
      { ator_papel: { [Op.notIn]: ['usuario'] } },
      { em_nome_de: { [Op.ne]: null } },
    ],
  };
  if (filtros.periodo) {
    where.criado_em = { [Op.gte]: filtros.periodo.inicio, [Op.lte]: filtros.periodo.fim };
  }

  const { rows, count } = await db.LogAuditoria.findAndCountAll({
    where,
    /* `antes`/`depois` são JSONB e pesam; a linha do tempo não os usa. O
       detalhe com diff é a tela de auditoria, uma linha por vez */
    attributes: [
      'id',
      'acao',
      'entidade',
      'entidade_id',
      'ator_id',
      'ator_papel',
      'em_nome_de',
      'motivo',
      'origem',
      'criado_em',
    ],
    /* o nome do ator em `include`: sem ele, vinte linhas viram vinte consultas */
    include: [{ model: db.Usuario, as: 'ator', attributes: ['id', 'nome'], required: false }],
    order: [['criado_em', 'DESC']],
    offset: filtros.offset,
    limit: filtros.limit,
  });

  return { itens: rows, pagina: filtros.pagina, porPagina: filtros.porPagina, total: count };
}

module.exports = { resumo, pendencias, atividadeAdministrativa };
