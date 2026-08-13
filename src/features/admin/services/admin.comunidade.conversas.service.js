'use strict';

const { Op } = require('sequelize');
const db = require('../../../models');
const historicoService = require('../../conversa/conversa.historico.service');
const moderacaoService = require('../../conversa/conversa.moderacao.service');
const conversaMapper = require('../../conversa/conversa.mapper');
const { erros } = require('../../../utils/erros');
const { registrarAcao } = require('../helpers/admin.auditoria.helper');
const { lerFiltros } = require('../helpers/admin.consulta.helper');
const { exigirEscopoTotal, invalidarPainel } = require('./admin.shared');

/**
 * Conversas no painel — a operação mais invasiva do sistema.
 *
 * `GET /conversas/:id` entrega ao Admin mensagem privada trocada entre duas
 * pessoas que não são ele. A cliente pediu poder total e ele existe — mas com
 * PREÇO, e o preço é o rastro (`documentacao/RBAC.md` §2). Concretamente:
 *
 *   1. **motivo obrigatório** (`esquemas.motivoAcesso`, mínimo de 10
 *      caracteres): sem motivo escrito, não há leitura. "abuso" não explica
 *      nada; uma frase curta explica;
 *   2. **vínculo com a denúncia** quando existe: se há denúncia sobre aquela
 *      conversa, o id é gravado junto. Não havendo, a leitura ainda é possível
 *      — o Admin é Admin — e o que sobra é o motivo, que passa a ser a única
 *      justificativa registrada. Isso está documentado de propósito: é o caso
 *      que mais merece revisão numa auditoria;
 *   3. **`logs_acesso_dado` por titular**, com o motivo e o `denuncia_id`. É o
 *      que permite responder a um titular que pergunte quem leu suas mensagens
 *      (LGPD, art. 18) — auditoria de alteração não cobre leitura, porque nada
 *      mudou no banco e é justamente a leitura que gera o risco.
 *
 * ### Nota sobre duplicidade de registro
 *
 * `conversa.acesso.service` já grava duas linhas genéricas ("leitura de
 * conversa pela moderação") a cada checagem de participação da moderação — é
 * dele o portão que autoriza a leitura, e não podemos passar o motivo por ali
 * sem editar a feature `conversa`. Por isso este service chama **uma única**
 * operação da feature (`historicoService.mensagens`, que já contém o portão) e
 * carrega o cabeçalho por conta própria: assim a leitura gera 2 linhas
 * genéricas + 2 motivadas, em vez das 6 que sairiam se cada composição
 * refizesse a checagem. As motivadas são as que respondem ao titular.
 */

/** recurso em `logs_acesso_dado` — mesmo nome usado pela feature `conversa` */
const RECURSO = 'conversa';

/** a coluna aceita 255; cortar aqui evita 500 no meio de uma leitura autorizada */
const MOTIVO_MAXIMO = 255;

const ORDENAVEIS = ['ultima_mensagem_em', 'criado_em', 'total_mensagens', 'status'];

/**
 * Denúncias abertas sobre a conversa — a própria e as das mensagens dela.
 *
 * Subconsulta correlacionada e não JOIN: o número precisa vir junto de cada
 * linha da página, e um `GROUP BY` à parte exigiria uma segunda ida ao banco e
 * a junção manual dos dois conjuntos.
 */
const DENUNCIAS_ABERTAS = db.Sequelize.literal(`(
  SELECT COUNT(*) FROM denuncias AS d
   WHERE d.status IN ('aberta', 'em_analise')
     AND (
       (d.alvo_tipo = 'conversa' AND d.alvo_id = "Conversa"."id")
       OR (d.alvo_tipo = 'mensagem' AND d.alvo_id IN (
             SELECT m.id FROM mensagens AS m WHERE m.conversa_id = "Conversa"."id"
          ))
     )
)`);

/** as duas partes — o mapper da feature ainda filtra WhatsApp por consentimento */
const parte = (as) => ({
  model: db.Usuario,
  as,
  attributes: ['id', 'nome', 'status'],
  include: [
    {
      model: db.Perfil,
      as: 'perfil',
      attributes: [
        'id',
        'slug',
        'tipo',
        'nome_exibicao',
        'foto_url',
        'verificado_em',
        'whatsapp',
        'exibir_whatsapp',
        'aceita_chat',
      ],
    },
  ],
});

/* lista branca explícita: `conversas` tem TEXT (`bloqueada_motivo`) que a
   listagem não usa e que sairia em toda linha */
const COLUNAS = [
  'id',
  'anuncio_id',
  'anunciante_id',
  'interessado_id',
  'status',
  'ultima_mensagem_em',
  'ultima_mensagem_previa',
  'ultima_mensagem_de',
  'total_mensagens',
  'encerrada_em',
  'moderada_em',
  'moderada_por',
  'criado_em',
];

const INCLUDES = () => [
  {
    model: db.Anuncio,
    as: 'anuncio',
    attributes: ['id', 'codigo', 'titulo', 'slug', 'status', 'preco_centavos'],
    paranoid: false,
  },
  parte('anunciante'),
  parte('interessado'),
];

// ─── MAPPER (lista branca) ──────────────────────────────────────

/**
 * Linha da lista administrativa.
 *
 * **Não reusa `conversa.mapper.item`** porque aquele mapper monta a visão de um
 * PARTICIPANTE ("a outra parte", "não lidas", "arquivada") e o Admin não é
 * parte: para ele as duas pontas são simétricas, e "não lidas" seria um número
 * de outra pessoa exibido como se fosse dele. A prévia da última mensagem
 * também fica de fora — é conteúdo privado, e conteúdo só sai por
 * `ver()`, com motivo e registro.
 */
const item = (registro) => ({
  id: registro.id,
  status: registro.status,
  anuncio: conversaMapper.anuncio(registro.anuncio),
  anunciante: conversaMapper.parte(registro.anunciante),
  interessado: conversaMapper.parte(registro.interessado),
  totalMensagens: registro.total_mensagens,
  ultimaMensagemEm: registro.ultima_mensagem_em,
  denunciasAbertas: Number(
    registro.get?.('denuncias_abertas') ?? registro.denuncias_abertas ?? 0
  ),
  encerradaEm: registro.encerrada_em,
  moderadaEm: registro.moderada_em,
  moderadaPor: registro.moderada_por,
  criadoEm: registro.criado_em,
});

// ─── LISTAGEM ───────────────────────────────────────────────────

/**
 * Lista de conversas — SEM conteúdo.
 *
 * O Admin escolhe qual conversa abrir a partir de metadado: partes, anúncio,
 * volume e denúncias em aberto. Mostrar a prévia da última mensagem já aqui
 * seria vazar conteúdo privado numa tela que não exige motivo — e a exigência
 * do §4 viraria formalidade contornável rolando a lista.
 */
async function listar(contexto, query = {}) {
  exigirEscopoTotal(contexto, 'conversa.ler', 'Você não tem permissão para ver as conversas.');

  const filtros = lerFiltros(query, {
    camposOrdenacao: ORDENAVEIS,
    ordemPadrao: 'ultima_mensagem_em',
  });

  const where = {};
  if (query.status) where.status = query.status;
  if (query.anuncioId) where.anuncio_id = query.anuncioId;
  if (query.usuarioId) {
    where[Op.or] = [{ anunciante_id: query.usuarioId }, { interessado_id: query.usuarioId }];
  }
  if (filtros.periodo) {
    where.criado_em = { [Op.gte]: filtros.periodo.inicio, [Op.lte]: filtros.periodo.fim };
  }
  /* a entrada normal desta tela: só o que tem denúncia em aberto */
  if (query.comDenuncia) {
    where[Op.and] = [db.Sequelize.where(DENUNCIAS_ABERTAS, { [Op.gt]: 0 })];
  }

  const { rows, count } = await db.Conversa.findAndCountAll({
    where,
    attributes: { include: [[DENUNCIAS_ABERTAS, 'denuncias_abertas']] },
    include: INCLUDES(),
    order: filtros.ordem,
    limit: filtros.limit,
    offset: filtros.offset,
    /* todos os includes são para-um: o LIMIT vale direto e nada duplica */
    subQuery: false,
    distinct: true,
  });

  return {
    itens: rows.map(item),
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    total: count,
  };
}

// ─── LEITURA DA CONVERSA (§4) ───────────────────────────────────

/**
 * Denúncia que justifica a leitura.
 *
 * Quando o Admin informa `denunciaId`, o vínculo é conferido: aceitar um id
 * qualquer permitiria colar o número de uma denúncia antiga em qualquer
 * leitura e a justificativa deixaria de significar algo. Sem `denunciaId`,
 * procuramos sozinhos — a denúncia aberta mais recente sobre a conversa ou
 * sobre uma mensagem dela.
 */
async function denunciaVinculada(conversaId, denunciaId) {
  if (denunciaId) {
    const informada = await db.Denuncia.findByPk(denunciaId, {
      attributes: ['id', 'alvo_tipo', 'alvo_id', 'status', 'motivo'],
    });

    if (!informada) return null;

    if (informada.alvo_tipo === 'conversa' && String(informada.alvo_id) === String(conversaId)) {
      return informada;
    }

    if (informada.alvo_tipo === 'mensagem') {
      const daConversa = await db.Mensagem.count({
        where: { id: informada.alvo_id, conversa_id: conversaId },
      });
      if (daConversa) return informada;
    }

    /* id válido mas de outra conversa: não vincula. A leitura segue possível,
       só que amparada apenas no motivo — e é isso que fica registrado */
    return null;
  }

  /* `escape` e não interpolação: `conversaId` chega validado como UUID pela
     rota, mas este service também é chamável de fora do Express — e uma
     literal montada com concatenação é o tipo de código que sobrevive à
     refatoração que remove a validação */
  const mensagensDa = db.Sequelize.literal(
    `(SELECT m.id FROM mensagens AS m WHERE m.conversa_id = ${db.sequelize.escape(String(conversaId))})`
  );

  return db.Denuncia.findOne({
    where: {
      status: { [Op.in]: ['aberta', 'em_analise'] },
      [Op.or]: [
        { alvo_tipo: 'conversa', alvo_id: conversaId },
        { alvo_tipo: 'mensagem', alvo_id: { [Op.in]: mensagensDa } },
      ],
    },
    attributes: ['id', 'alvo_tipo', 'alvo_id', 'status', 'motivo'],
    order: [['criado_em', 'DESC']],
  });
}

/**
 * Uma linha por titular, com o motivo escrito por quem leu.
 *
 * Não usa `.catch(silencioso)` como os registros acessórios do projeto: aqui o
 * log **é** a contrapartida do poder. Se ele falhar, a leitura não acontece —
 * ler sem deixar rastro é exatamente a situação que a regra existe para
 * impedir, e devolver o conteúdo com o registro perdido seria o pior dos dois
 * mundos.
 */
async function registrarLeitura(contexto, conversa, { motivo, denuncia }) {
  const titulares = [...new Set([conversa.anunciante_id, conversa.interessado_id])].filter(
    (id) => id && String(id) !== String(contexto.usuarioId)
  );

  if (!titulares.length) return;

  await db.LogAcessoDado.bulkCreate(
    titulares.map((titularId) => ({
      ator_id: contexto.usuarioId,
      titular_id: titularId,
      recurso: RECURSO,
      recurso_id: conversa.id,
      motivo: String(motivo).slice(0, MOTIVO_MAXIMO),
      denuncia_id: denuncia?.id || null,
      ip_hash: contexto.ipHash || null,
      user_agent: contexto.userAgent || null,
    }))
  );
}

/**
 * Abre a conversa: cabeçalho + página de mensagens por CURSOR.
 *
 * Cursor e não offset porque chat não tolera offset — entre carregar a página 1
 * e pedir a 2, uma mensagem nova entra no topo, tudo desce e a primeira linha
 * da página 2 é a que já foi lida; a anterior a ela some para sempre. Quem
 * implementa isso é `conversa.historico.service`, e é ele que também carrega o
 * portão de acesso (404 para quem não pode ler, sem confirmar que o id existe).
 *
 * Ordem das operações, que não é arbitrária:
 *   1. o portão (dentro de `mensagens`) — nada acontece antes de autorizar;
 *   2. o registro do acesso, que precisa existir ANTES de a resposta sair;
 *   3. a auditoria administrativa;
 *   4. o carimbo `moderada_em/_por` na conversa, para que as duas partes
 *      possam ver que houve moderação.
 */
async function ver(contexto, conversaId, opcoes = {}) {
  exigirEscopoTotal(contexto, 'conversa.ler', 'Você não tem permissão para ler conversas.');

  const { motivo, denunciaId, antesDe, limite } = opcoes;

  /* defesa em profundidade: o esquema da rota já exige o motivo, mas este
     service também é chamável de fora do Express (script, job) e ler conversa
     privada não pode depender de a rota estar certa */
  if (!motivo || String(motivo).trim().length < 10) {
    throw erros.validacao({ motivo: 'Registre o motivo para ler esta conversa.' });
  }

  /* autoriza e traz a página de mensagens numa só passagem */
  const pagina = await historicoService.mensagens(contexto, conversaId, { antesDe, limite });

  const conversa = await db.Conversa.findByPk(conversaId, {
    attributes: COLUNAS,
    include: INCLUDES(),
  });

  const denuncia = await denunciaVinculada(conversaId, denunciaId);

  await registrarLeitura(contexto, conversa, { motivo, denuncia });

  await registrarAcao(contexto, {
    acao: 'acessar_dado_pessoal',
    entidade: 'conversas',
    entidadeId: conversa.id,
    motivo: String(motivo).slice(0, MOTIVO_MAXIMO),
    depois: {
      denunciaId: denuncia?.id || null,
      /* sem denúncia a leitura fica amparada só no motivo — sinalizar isso na
         trilha é o que faz a revisão posterior olhar para o caso certo */
      semVinculo: !denuncia,
      titulares: [conversa.anunciante_id, conversa.interessado_id],
    },
  });

  /* as partes veem que a conversa passou por moderação: leitura silenciosa é
     o que transforma "poder com rastro" em vigilância */
  await db.Conversa.update(
    { moderada_em: new Date(), moderada_por: contexto.usuarioId },
    { where: { id: conversa.id } }
  );

  return {
    conversa: item(conversa),
    acesso: {
      motivo,
      denunciaId: denuncia?.id || null,
      registradoEm: new Date(),
    },
    mensagens: pagina.itens.map((mensagem) =>
      conversaMapper.mensagem(mensagem, { usuarioId: contexto.usuarioId })
    ),
    proximoCursor: pagina.proximoCursor,
  };
}

/**
 * Remoção de mensagem — soft delete com motivo, delegado à feature.
 *
 * `removida_em` e não DELETE porque quem apaga uma mensagem não pode apagar a
 * prova de que ela existiu: sem o registro, a denúncia de abuso chega à
 * moderação sem base e a palavra de um vale a do outro. O conteúdo permanece na
 * coluna e é o mapper que o troca por "Mensagem removida." na resposta.
 *
 * A auditoria é gravada pela feature, com o motivo e com `emNomeDe` apontando
 * para o autor da mensagem quando quem remove é a moderação.
 */
async function removerMensagem(contexto, mensagemId, { motivo }) {
  const resultado = await moderacaoService.removerMensagem(contexto, mensagemId, { motivo });

  await invalidarPainel();

  return { id: mensagemId, removida: resultado.removida, removidaEm: resultado.em };
}

module.exports = { listar, ver, removerMensagem, item };
