'use strict';

const db = require('../../models');
const filas = require('../../filas');
const cache = require('../../cache');
const tempoReal = require('../../tempo-real');
const auditoria = require('../auditoria/auditoria.service');
const { escopoDe } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { chaves } = require('./moderacao.cache');
const { MOTIVO_MINIMO } = require('./moderacao.constants');

/**
 * Peças que todas as ações de moderação usam igual.
 *
 * Não é um service: não implementa nenhum caso de uso. É a cola que garante
 * que as seis ações punitivas do módulo apliquem **as mesmas** quatro regras —
 * escopo total, motivo escrito, imparcialidade e rastro — em vez de cada uma
 * lembrar de quatro coisas por conta própria. Regra repetida em seis arquivos
 * é regra que um dia só é corrigida em cinco.
 */

/**
 * A mesa de moderação exige escopo `todos`.
 *
 * `autorizar()` na rota confere só a capacidade, e o usuário comum TEM
 * `anuncio.ler.proprio` — passaria pela rota e receberia uma fila com os
 * próprios anúncios, o que é pior que um 403: parece funcionar.
 */
function exigirEscopoTotal(contexto, acao) {
  if (escopoDe(contexto, acao) === 'todos') return true;
  throw erros.semPermissao('Você não tem permissão para acessar a moderação.', {
    permissao: `${acao}.todos`,
  });
}

/** ação punitiva sem justificativa gravada não existe neste módulo */
function exigirMotivo(motivo, campo = 'motivo') {
  const texto = String(motivo || '').trim();
  if (texto.length >= MOTIVO_MINIMO) return texto;

  throw erros.validacao({
    [campo]: 'Informe o motivo — ação de moderação sem justificativa não é registrada.',
  });
}

/** ninguém modera a si mesmo: nem se aprova, nem se inocenta, nem se restaura */
function garantirNaoEhVoceMesmo(contexto, donoId) {
  if (donoId && String(donoId) === String(contexto.usuarioId)) {
    throw erros.semPermissao('Você não pode aplicar uma ação de moderação sobre si mesmo.', {
      code: 'CONFLITO_DE_INTERESSE',
    });
  }
}

/**
 * Ação sobre conta de Admin exige ser Admin.
 *
 * Sem isto, um moderador banindo o Admin derrubaria quem administra a
 * plataforma — e a permissão `usuario.banir.todos` que ele legitimamente tem
 * não distingue alvo. A distinção precisa ser feita aqui.
 *
 * O `contexto.admin` do RBAC é o coringa `*`, não um `if` de papel: quem
 * receber o coringa amanhã passa por aqui sem ninguém editar este arquivo.
 */
async function garantirPodeAgirSobre(contexto, usuarioId) {
  garantirNaoEhVoceMesmo(contexto, usuarioId);

  /* um JOIN só: saber os papéis do alvo não pode custar uma consulta por papel */
  const alvo = await db.Usuario.findByPk(usuarioId, {
    attributes: ['id'],
    include: [
      { model: db.Papel, as: 'papeis', attributes: ['chave'], through: { attributes: [] } },
    ],
  });

  if (!alvo) throw erros.naoEncontrado('Usuário');

  const alvoEhAdmin = (alvo.papeis || []).some((papel) => papel.chave === 'admin');

  if (alvoEhAdmin && !contexto.admin) {
    throw erros.semPermissao('Somente um administrador pode agir sobre a conta de outro.', {
      code: 'ALVO_ADMINISTRADOR',
    });
  }

  return { alvoEhAdmin };
}

/**
 * Rastro + aviso ao afetado + invalidação do painel, na ordem certa.
 *
 * A auditoria vem PRIMEIRO e é aguardada: se a linha do log não entrar, o
 * afetado não deve ser notificado de uma punição que ninguém consegue explicar
 * depois. A notificação vai para a fila, fora do caminho da resposta.
 */
async function registrarAcao(contexto, { acao, entidade, entidadeId, antes, depois, motivo, notificar }) {
  await auditoria.registrar(contexto, { acao, entidade, entidadeId, antes, depois, motivo });

  if (notificar?.usuarioId) {
    await filas.enfileirar('notificacao.criar', {
      usuarioId: notificar.usuarioId,
      tipo: notificar.tipo,
      titulo: notificar.titulo,
      mensagem: notificar.mensagem,
      dados: notificar.dados || {},
      entidade,
      entidadeId,
      canais: ['sistema', 'email'],
    });
  }

  /* o painel mostra contadores; qualquer ação daqui mexe em pelo menos um
     deles, então invalidar sempre é mais barato que decidir quando */
  await cache.remover(chaves.painel());
}

/** carrega o anúncio ou 404 — sempre inteiro, porque o dono decide o escopo */
async function carregarAnuncio(anuncioId) {
  const anuncio = await db.Anuncio.findByPk(anuncioId);
  if (!anuncio) throw erros.naoEncontrado('Anúncio');
  return anuncio;
}

/**
 * Linha da trilha do ANÚNCIO. Roda dentro da transação da mudança: histórico
 * sem mudança e mudança sem histórico são estados igualmente inúteis.
 *
 * Não substitui `logs_auditoria` — ali a pergunta é "o que este ator fez"; aqui
 * é "o que aconteceu com este anúncio", e é esta que o dono também lê.
 */
const registrarHistoricoDoAnuncio = (
  anuncio,
  contexto,
  { statusAnterior, statusNovo, motivo, alteracoes },
  transacao
) =>
  db.AnuncioHistorico.create(
    {
      anuncio_id: anuncio.id,
      status_anterior: statusAnterior,
      status_novo: statusNovo,
      ator_id: contexto.usuarioId,
      ator_papel: (contexto.papeis || [])[0] || null,
      motivo: motivo || null,
      alteracoes: alteracoes || null,
      ip_hash: contexto.ipHash || null,
    },
    { transaction: transacao }
  );

/** avisa a tela do dono e o painel — depois de gravado, nunca antes */
function emitirModeracao(anuncio, decisao) {
  tempoReal.paraUsuario(anuncio.usuario_id, tempoReal.EVENTOS.ANUNCIO_MODERADO, {
    anuncioId: anuncio.id,
    codigo: anuncio.codigo,
    decisao,
  });
  tempoReal.paraSala(tempoReal.salas.moderacao(), tempoReal.EVENTOS.MODERACAO_PENDENTE, {
    anuncioId: anuncio.id,
    decisao,
  });
}

module.exports = {
  exigirEscopoTotal,
  exigirMotivo,
  garantirNaoEhVoceMesmo,
  garantirPodeAgirSobre,
  registrarAcao,
  carregarAnuncio,
  registrarHistoricoDoAnuncio,
  emitirModeracao,
};
