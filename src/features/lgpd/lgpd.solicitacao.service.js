'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const config = require('../../config');
const filas = require('../../filas');
const auditoria = require('../auditoria/auditoria.service');
const { RECURSO_ACESSO } = require('../auditoria/auditoria.constants');
const { erros } = require('../../utils/erros');
const { lerPaginacao } = require('../../utils/paginacao');
const { adicionarDias } = require('../../utils/datas');
const { exigir, pode, filtroDeEscopo } = require('../../rbac');
const {
  PRAZO_RESPOSTA_DIAS,
  ALERTA_VENCIMENTO_DIAS,
  STATUS_FINAIS,
} = require('./lgpd.constants');

/**
 * Direitos do titular (LGPD, art. 18) — a fila de pedidos e o relógio dela.
 *
 * O que este service protege não é o pedido em si, é o PRAZO: a lei dá 15 dias
 * para a resposta completa (art. 19, II) e exige que o controlador comprove o
 * atendimento. Um pedido que chega por e-mail e vira tarefa mental de alguém
 * não tem como ser comprovado nem cobrado.
 */

const COLUNAS = [
  'id',
  'usuario_id',
  'email_solicitante',
  'tipo',
  'status',
  'descricao',
  'identidade_verificada_em',
  'prazo_em',
  'respondida_em',
  'respondida_por',
  'resposta',
  'arquivo_url',
  'criado_em',
];

/** dias que faltam (negativo = atrasada) e se entrou na faixa de alerta */
function situacaoDoPrazo(registro) {
  if (!registro.prazo_em) return { diasRestantes: null, vencendo: false, atrasada: false };

  const finalizada = STATUS_FINAIS.includes(registro.status);
  const diasRestantes = Math.ceil((new Date(registro.prazo_em) - Date.now()) / (24 * 60 * 60 * 1000));

  return {
    diasRestantes,
    vencendo: !finalizada && diasRestantes >= 0 && diasRestantes <= ALERTA_VENCIMENTO_DIAS,
    atrasada: !finalizada && diasRestantes < 0,
  };
}

/**
 * Abre uma solicitação.
 *
 * O titular só pede sobre os próprios dados: `usuario_id` vem do contexto, e
 * um `usuarioId` no corpo apontando para outra pessoa passa pelo RBAC — que
 * nega, porque `lgpd.solicitar` só existe com escopo `proprio`. Aceitar o
 * campo e recusar é melhor do que ignorá-lo em silêncio: a tentativa fica
 * registrada e o cliente recebe 403 em vez de um pedido criado no lugar errado.
 */
async function abrir(dados, contexto) {
  const alvoId = dados.usuarioId || contexto.usuarioId;

  exigir(contexto, 'lgpd.solicitar', { donoId: alvoId });

  /* um pedido aberto por vez, por tipo: dez pedidos de acesso do mesmo titular
     não geram dez direitos, geram dez prazos correndo contra a empresa */
  const emAberto = await db.SolicitacaoTitular.findOne({
    where: { usuario_id: alvoId, tipo: dados.tipo, status: { [Op.notIn]: STATUS_FINAIS } },
    attributes: ['id', 'criado_em', 'prazo_em'],
  });

  if (emAberto) {
    throw erros.conflito('Você já tem uma solicitação deste tipo em andamento.', {
      solicitacaoId: emAberto.id,
      prazoEm: emAberto.prazo_em,
    });
  }

  const solicitacao = await db.SolicitacaoTitular.create({
    usuario_id: alvoId,
    email_solicitante: contexto.usuario?.email || dados.email,
    tipo: dados.tipo,
    status: 'aberta',
    descricao: dados.descricao || null,
    /* a sessão autenticada com e-mail já confirmado É a verificação de
       identidade; exigir documento de novo seria coletar mais dado pessoal
       para atender a um pedido de privacidade */
    identidade_verificada_em: contexto.usuario?.email_verificado_em ? new Date() : null,
    prazo_em: adicionarDias(PRAZO_RESPOSTA_DIAS),
    ip_hash: contexto.ipHash || null,
  });

  await auditoria.registrar(contexto, {
    acao: 'criar',
    entidade: 'solicitacao_titular',
    entidadeId: solicitacao.id,
    depois: { tipo: solicitacao.tipo, status: solicitacao.status, prazoEm: solicitacao.prazo_em },
  });

  /* o encarregado precisa saber que o relógio começou; o e-mail vai pela fila
     porque a abertura do pedido não pode depender do provedor de e-mail */
  await filas
    .enfileirar('email.enviar', {
      para: config.lgpd.encarregadoEmail,
      assunto: `[LGPD] Nova solicitação de titular — ${solicitacao.tipo}`,
      texto:
        `Uma solicitação de titular foi aberta.\n\n` +
        `Tipo: ${solicitacao.tipo}\nProtocolo: ${solicitacao.id}\n` +
        `Prazo legal: ${new Date(solicitacao.prazo_em).toLocaleDateString('pt-BR')} ` +
        `(${PRAZO_RESPOSTA_DIAS} dias).`,
    })
    .catch(() => null);

  return solicitacao;
}

/** as minhas — o titular acompanha o próprio protocolo */
async function minhas(contexto, filtros = {}) {
  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros, { maximo: 50 });

  const where = { usuario_id: contexto.usuarioId };
  if (filtros.status) where.status = filtros.status;
  if (filtros.tipo) where.tipo = filtros.tipo;

  const { rows, count } = await db.SolicitacaoTitular.findAndCountAll({
    where,
    attributes: COLUNAS,
    order: [['criado_em', 'DESC']],
    offset,
    limit,
  });

  return { itens: rows, pagina, porPagina, total: count };
}

/**
 * A fila do encarregado.
 *
 * Ordenada por prazo, não por data de criação: o que importa para quem atende
 * é o que vence primeiro. `filtroDeEscopo` garante que quem só tem
 * `ler_solicitacoes.propria` receba as suas — sem buscar tudo e filtrar depois.
 */
async function listar(contexto, filtros = {}) {
  const escopo = filtroDeEscopo(contexto, 'lgpd.ler_solicitacoes', 'usuario_id');
  if (!escopo) throw erros.semPermissao('Você não pode ver solicitações de titular.');

  const where = { ...escopo };
  if (filtros.status) where.status = filtros.status;
  if (filtros.tipo) where.tipo = filtros.tipo;
  if (filtros.de || filtros.ate) {
    where.criado_em = {
      ...(filtros.de ? { [Op.gte]: new Date(filtros.de) } : {}),
      ...(filtros.ate ? { [Op.lte]: new Date(filtros.ate) } : {}),
    };
  }

  if (filtros.vencendo) {
    where.status = { [Op.notIn]: STATUS_FINAIS };
    where.prazo_em = { [Op.lte]: adicionarDias(ALERTA_VENCIMENTO_DIAS) };
  }

  const { pagina, porPagina, offset, limit } = lerPaginacao(filtros, { maximo: 100 });

  const { rows, count } = await db.SolicitacaoTitular.findAndCountAll({
    where,
    attributes: COLUNAS,
    include: [{ model: db.Usuario, as: 'usuario', attributes: ['id', 'nome'], required: false }],
    order: [['prazo_em', 'ASC'], ['criado_em', 'DESC']],
    offset,
    limit,
  });

  /* abrir a fila do DPO é ler dado de terceiro: uma linha por titular, em lote */
  await auditoria.registrarAcessoEmLote(contexto, {
    titularIds: rows.map((linha) => linha.usuario_id),
    recurso: RECURSO_ACESSO.SOLICITACAO_TITULAR,
    motivo: 'atendimento da fila de solicitações de titular',
  });

  return { itens: rows, pagina, porPagina, total: count };
}

/** contadores para o painel do encarregado — não paga `COUNT(*)` por linha */
async function resumo(contexto) {
  exigir(contexto, 'lgpd.ler_solicitacoes');

  const [abertas, vencendo, atrasadas] = await Promise.all([
    db.SolicitacaoTitular.count({ where: { status: { [Op.notIn]: STATUS_FINAIS } } }),
    db.SolicitacaoTitular.count({
      where: {
        status: { [Op.notIn]: STATUS_FINAIS },
        prazo_em: { [Op.between]: [new Date(), adicionarDias(ALERTA_VENCIMENTO_DIAS)] },
      },
    }),
    db.SolicitacaoTitular.count({
      where: { status: { [Op.notIn]: STATUS_FINAIS }, prazo_em: { [Op.lt]: new Date() } },
    }),
  ]);

  return { abertas, vencendo, atrasadas, prazoDias: PRAZO_RESPOSTA_DIAS };
}

/**
 * Uma solicitação. 404 e não 403 quando não é sua e você não tem escopo: o
 * código de erro não pode servir para descobrir que o protocolo existe.
 */
async function obter(id, contexto) {
  const registro = await db.SolicitacaoTitular.findByPk(id, { attributes: COLUNAS });
  if (!registro) throw erros.naoEncontrado('Solicitação');

  const dono = String(registro.usuario_id) === String(contexto.usuarioId);
  if (!dono && !pode(contexto, 'lgpd.ler_solicitacoes', { donoId: registro.usuario_id })) {
    throw erros.naoEncontrado('Solicitação');
  }

  if (!dono) {
    await auditoria.registrarAcessoDado(contexto, {
      titularId: registro.usuario_id,
      recurso: RECURSO_ACESSO.SOLICITACAO_TITULAR,
      recursoId: registro.id,
      motivo: 'atendimento de solicitação de titular',
    });
  }

  return registro;
}

/** responde e encerra (ou passa para em_atendimento) */
async function responder(id, dados, contexto) {
  exigir(contexto, 'lgpd.responder_solicitacao');

  const registro = await db.SolicitacaoTitular.findByPk(id);
  if (!registro) throw erros.naoEncontrado('Solicitação');

  if (STATUS_FINAIS.includes(registro.status)) {
    throw erros.conflito('Esta solicitação já foi encerrada.', { status: registro.status });
  }

  const antes = { status: registro.status, resposta: registro.resposta };
  const finaliza = STATUS_FINAIS.includes(dados.status);

  await registro.update({
    status: dados.status,
    resposta: dados.resposta,
    respondida_em: finaliza ? new Date() : registro.respondida_em,
    respondida_por: contexto.usuarioId,
  });

  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: 'solicitacao_titular',
    entidadeId: registro.id,
    antes,
    depois: { status: registro.status },
    motivo: dados.resposta,
  });

  await auditoria.registrarAcessoDado(contexto, {
    titularId: registro.usuario_id,
    recurso: RECURSO_ACESSO.SOLICITACAO_TITULAR,
    recursoId: registro.id,
    motivo: 'resposta a solicitação de titular',
  });

  if (registro.email_solicitante) {
    await filas
      .enfileirar('email.enviar', {
        para: registro.email_solicitante,
        assunto: 'Sua solicitação de privacidade — AgroPeças MT',
        texto:
          `Sua solicitação (protocolo ${registro.id}) foi respondida.\n\n` +
          `Situação: ${registro.status}\n\n${dados.resposta}`,
      })
      .catch(() => null);
  }

  return registro;
}

module.exports = {
  abrir,
  minhas,
  listar,
  resumo,
  obter,
  responder,
  situacaoDoPrazo,
  PRAZO_RESPOSTA_DIAS,
  COLUNAS,
};
