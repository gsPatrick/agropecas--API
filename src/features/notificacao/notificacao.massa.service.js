'use strict';

const crypto = require('crypto');
const db = require('../../models');
const filas = require('../../filas');
const tempoReal = require('../../tempo-real');
const { exigir } = require('../../rbac');
const auditoria = require('../auditoria/auditoria.service');
const templateService = require('./notificacao.template.service');
const contadorService = require('./notificacao.contador.service');
const { limparDados } = require('./notificacao.criacao.service');
const mapper = require('./notificacao.mapper');
const {
  CANAIS_ENTREGUES,
  LOTE_TAMANHO,
  ENTIDADE_COMUNICADO,
} = require('./notificacao.constants');

const { Op, fn, col } = db.Sequelize;

/**
 * Comunicado do Admin para muita gente ("manutenção no domingo", "nova
 * categoria no ar").
 *
 * Três coisas moldam este arquivo:
 *
 * 1. **Nunca carregar todos os usuários na memória.** Uma base de 50 mil
 *    contas viraria 50 mil objetos num array antes do primeiro INSERT. O
 *    trabalho pagina por *keyset* (`id > cursor`, ordenado por id) e cada
 *    bloco reenfileira o próximo. Keyset e não OFFSET: com OFFSET, um cadastro
 *    novo no meio do envio desloca a janela e alguém fica sem receber.
 *
 * 2. **`bulkCreate`, nunca um INSERT por pessoa.** Um laço de `create()` com
 *    50 mil idas ao banco é o que transforma um comunicado em incidente.
 *
 * 3. **Idempotência pelo lote.** Toda linha nasce com
 *    `referencia_id = loteId`; antes de inserir, o bloco descarta quem já tem
 *    linha daquele lote. Assim uma retentativa do job (que a fila faz sozinha
 *    quando o banco oscila) reprocessa sem duplicar o aviso na tela de
 *    ninguém.
 */

/**
 * Registra o comunicado e devolve na hora — quem dispara não espera o envio.
 *
 * A auditoria é gravada AQUI, no ato do pedido, e não no job: o que precisa de
 * rastro é a decisão humana de falar com a base inteira. Se o job falhar
 * depois, o registro de quem mandou continua existindo.
 */
async function agendar(contexto, entrada) {
  exigir(contexto, 'notificacao.enviar');

  const canais = [...new Set(entrada.canais || ['sistema'])].filter((canal) =>
    CANAIS_ENTREGUES.includes(canal)
  );

  const lote = {
    loteId: crypto.randomUUID(),
    tipo: entrada.tipo,
    titulo: entrada.titulo,
    mensagem: entrada.mensagem,
    dados: limparDados(entrada.dados),
    canais: canais.length ? canais : ['sistema'],
    segmento: entrada.segmento || {},
  };

  await auditoria.registrar(contexto, {
    /* `acao` é enum fechado no banco (AUDITORIA_ACAO); não há um valor
       "enviar_comunicado", então o disparo é registrado como criação sobre a
       entidade `notificacoes`, com o id do lote e o segmento no `depois` —
       ver pendências na documentação da feature */
    acao: 'criar',
    entidade: 'notificacoes',
    entidadeId: lote.loteId,
    depois: {
      tipo: lote.tipo,
      titulo: lote.titulo,
      canais: lote.canais,
      segmento: lote.segmento,
    },
    motivo: entrada.motivo || null,
  });

  await filas.enfileirar('notificacao.enviarEmMassa', { ...lote, cursor: null });

  return { loteId: lote.loteId, canais: lote.canais, segmento: lote.segmento, situacao: 'enfileirado' };
}

/** monta o `where` do segmento — filtro na consulta, nunca na aplicação */
function consultaDoSegmento(segmento = {}, cursor) {
  const where = {
    /* conta removida foi anonimizada por pedido do titular e conta banida foi
       expulsa: comunicado da plataforma não alcança nenhuma das duas */
    status: { [Op.in]: segmento.status?.length ? segmento.status : ['ativo', 'pendente'] },
  };

  if (cursor) where.id = { [Op.gt]: cursor };
  if (segmento.usuarioIds?.length) {
    where.id = cursor
      ? { [Op.gt]: cursor, [Op.in]: segmento.usuarioIds }
      : { [Op.in]: segmento.usuarioIds };
  }

  const include = [];
  if (segmento.tipoPerfil || segmento.uf) {
    include.push({
      model: db.Perfil,
      as: 'perfil',
      attributes: [],
      required: true,
      where: {
        ...(segmento.tipoPerfil ? { tipo: segmento.tipoPerfil } : {}),
        ...(segmento.uf ? { uf: segmento.uf } : {}),
      },
    });
  }

  return { where, include };
}

/**
 * Processa UM bloco e devolve o cursor do próximo (ou null no fim).
 *
 * Chamado pelo job `notificacao.enviarEmMassa`. Fica no service, e não dentro
 * do arquivo de trabalho, porque o job não deve conter regra: é o mesmo
 * princípio que mantém regra fora do controller.
 */
async function processarBloco({ loteId, tipo, titulo, mensagem, dados = {}, canais = ['sistema'], segmento = {}, cursor = null }) {
  const { where, include } = consultaDoSegmento(segmento, cursor);

  const usuarios = await db.Usuario.findAll({
    attributes: ['id', 'nome', 'email'],
    where,
    include,
    order: [['id', 'ASC']],
    limit: LOTE_TAMANHO,
    raw: true,
  });

  if (!usuarios.length) return { criadas: 0, proximoCursor: null, fim: true };

  const ids = usuarios.map((usuario) => usuario.id);
  const proximoCursor = ids[ids.length - 1];

  /* quem já recebeu este lote fica de fora — é o que torna a retentativa do
     job inofensiva em vez de gerar aviso repetido */
  const jaRecebeu = new Set(
    (
      await db.Notificacao.findAll({
        attributes: ['usuario_id', 'canal'],
        where: {
          referencia_tipo: ENTIDADE_COMUNICADO,
          referencia_id: loteId,
          usuario_id: { [Op.in]: ids },
        },
        raw: true,
      })
    ).map((linha) => `${linha.usuario_id}:${linha.canal}`)
  );

  /* preferências do bloco inteiro numa consulta: perguntar por usuário dentro
     do laço seria N+1 vezes 500 */
  const desligadas = new Set(
    (
      await db.NotificacaoPreferencia.findAll({
        attributes: ['usuario_id', 'canal'],
        where: {
          usuario_id: { [Op.in]: ids },
          tipo,
          canal: { [Op.in]: canais },
          ativo: false,
        },
        raw: true,
      })
    ).map((linha) => `${linha.usuario_id}:${linha.canal}`)
  );

  const agora = new Date();
  const linhas = [];
  const paraEmail = [];

  usuarios.forEach((usuario) => {
    canais.forEach((canal) => {
      const chave = `${usuario.id}:${canal}`;
      if (jaRecebeu.has(chave) || desligadas.has(chave)) return;
      if (canal === 'email' && !usuario.email) return;

      linhas.push({
        usuario_id: usuario.id,
        tipo,
        canal,
        titulo: templateService.renderizar(titulo, { ...dados, nome: usuario.nome }),
        corpo: templateService.renderizar(mensagem, { ...dados, nome: usuario.nome }),
        link: typeof dados.link === 'string' ? dados.link.slice(0, 500) : null,
        dados,
        referencia_tipo: ENTIDADE_COMUNICADO,
        referencia_id: loteId,
        enviada_em: canal === 'sistema' ? agora : null,
      });

      if (canal === 'email') paraEmail.push(usuario);
    });
  });

  if (!linhas.length) return { criadas: 0, proximoCursor, fim: false };

  const criadas = await db.Notificacao.bulkCreate(linhas, { returning: true });

  await entregar(criadas);
  await encadearEmails(criadas, paraEmail);

  return { criadas: criadas.length, proximoCursor, fim: false };
}

/**
 * Entrega em tempo real do bloco.
 *
 * O caro num lote não é o `emit` — é o trabalho de banco por trás dele. Por
 * isso aqui NÃO se recalcula o contador de cada pessoa: o cache das 500 é
 * derrubado num comando só, e o evento leva apenas o aviso. Quem estiver com a
 * tela aberta pede o contador uma vez; quem não estiver vê ao entrar.
 *
 * As emissões são disparos em memória no barramento do Socket.IO, sem `await`
 * e sem consulta, então o bloco não vira 500 idas e voltas sequenciais.
 */
async function entregar(criadas) {
  const doSistema = criadas.filter((linha) => linha.canal === 'sistema');
  if (!doSistema.length) return;

  await contadorService.invalidarMuitos(doSistema.map((linha) => linha.usuario_id));

  doSistema.forEach((linha) => {
    tempoReal.paraUsuario(linha.usuario_id, tempoReal.EVENTOS.NOTIFICACAO_NOVA, {
      notificacao: mapper.notificacao(linha),
      emLote: true,
    });
  });
}

/** um job de e-mail por destinatário, com chave única pela linha criada */
async function encadearEmails(criadas, usuarios) {
  const porUsuario = new Map(usuarios.map((usuario) => [usuario.id, usuario]));

  await Promise.all(
    criadas
      .filter((linha) => linha.canal === 'email')
      .map((linha) => {
        const usuario = porUsuario.get(linha.usuario_id);
        if (!usuario?.email) return null;

        return filas
          .enfileirar(
            'email.enviar',
            { para: usuario.email, assunto: linha.titulo, texto: linha.corpo },
            { chaveUnica: `notificacao:${linha.id}` }
          )
          .catch(() => null);
      })
  );
}

/**
 * Comunicados já enviados.
 *
 * Não existe tabela `comunicados` — cada disparo em massa é um lote de
 * `Notificacao` (uma linha por destinatário/canal), e o que junta essas
 * linhas de volta num "comunicado" é `logs_auditoria`: `agendar()` grava um
 * registro por lote (`entidade: 'notificacoes', entidadeId: loteId`) com o
 * texto ORIGINAL do template em `depois` — não o renderizado por pessoa
 * (`{nome}` já substituído), que varia linha a linha e não serviria de
 * título para a lista. É a mesma trilha de auditoria, lida de outro ângulo,
 * em vez de uma tabela nova só para guardar o que já está gravado.
 */
async function listar(contexto, { pagina = 1, porPagina = 20 } = {}) {
  exigir(contexto, 'notificacao.enviar');

  const limit = Math.min(porPagina, 50);
  const offset = (Math.max(pagina, 1) - 1) * limit;

  const { rows, count } = await db.LogAuditoria.findAndCountAll({
    where: { entidade: 'notificacoes', acao: 'criar' },
    include: [{ model: db.Usuario, as: 'ator', attributes: ['id', 'nome'], required: false }],
    order: [['criado_em', 'DESC']],
    limit,
    offset,
  });

  const loteIds = rows.map((linha) => linha.entidade_id).filter(Boolean);

  /* alcance real: quantas linhas de Notificacao o lote de fato criou — pode
     ser menor que o segmento pedia (quem tinha o canal desligado nas
     preferências não recebeu, e não é erro, é preferência respeitada) */
  const contagens = loteIds.length
    ? await db.Notificacao.findAll({
        attributes: ['referencia_id', [fn('COUNT', col('id')), 'total']],
        where: { referencia_tipo: ENTIDADE_COMUNICADO, referencia_id: { [Op.in]: loteIds } },
        group: ['referencia_id'],
        raw: true,
      })
    : [];

  const alcancePorLote = new Map(contagens.map((linha) => [linha.referencia_id, Number(linha.total)]));

  const itens = rows.map((linha) => ({
    loteId: linha.entidade_id,
    tipo: linha.depois?.tipo || null,
    titulo: linha.depois?.titulo || null,
    canais: linha.depois?.canais || [],
    segmento: linha.depois?.segmento || {},
    alcance: alcancePorLote.get(linha.entidade_id) || 0,
    enviadoPor: linha.ator ? { id: linha.ator.id, nome: linha.ator.nome } : null,
    enviadoEm: linha.criado_em,
  }));

  return { itens, total: count, pagina, porPagina: limit };
}

module.exports = { agendar, processarBloco, consultaDoSegmento, listar };
