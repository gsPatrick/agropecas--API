'use strict';

const db = require('../../models');
const tempoReal = require('../../tempo-real');
const { pode, filtroDeEscopo } = require('../../rbac');
const { erros } = require('../../utils/erros');
const contadorService = require('./notificacao.contador.service');
const { MARCAR_LOTE_MAXIMO } = require('./notificacao.constants');

const { Op } = db.Sequelize;

/**
 * Marcar como lida — uma, várias ou todas.
 *
 * **Notificação inexistente e notificação alheia devolvem exatamente a mesma
 * resposta: 403.** Diferenciar 404 de 403 aqui entregaria um oráculo de
 * enumeração: quem tivesse uma lista de UUIDs saberia quais existem no sistema
 * pela diferença no código de erro. Como o id não é adivinhável e a operação
 * não é pública, "não é seu" e "não existe" são o mesmo fato do lado de fora.
 */
function negar() {
  return erros.semPermissao('Notificação não encontrada ou não pertence a você.');
}

/** avisa as outras abas/aparelhos do dono, e só ele */
async function avisar(usuarioId, dados) {
  const contagem = await contadorService.atualizarEEmitir(usuarioId);
  tempoReal.paraUsuario(usuarioId, tempoReal.EVENTOS.NOTIFICACAO_LIDA, {
    ...dados,
    naoLidas: contagem.naoLidas,
  });
  return contagem;
}

async function marcarUma(contexto, id) {
  const registro = await db.Notificacao.findByPk(id, {
    attributes: ['id', 'usuario_id', 'lida_em'],
  });

  /* o escopo só pode ser conferido depois de saber de quem é a linha — é por
     isso que esta checagem mora no service e não num middleware */
  if (!registro) throw negar();
  if (!pode(contexto, 'notificacao.marcar_lida', { donoId: registro.usuario_id })) throw negar();

  if (!registro.lida_em) {
    await registro.update({ lida_em: new Date() });
    await avisar(registro.usuario_id, { ids: [registro.id] });
  }

  return { id: registro.id, lida: true };
}

/**
 * Lote com teto.
 *
 * O `UPDATE ... WHERE id IN (...)` já carrega o filtro de escopo, então um id
 * alheio no meio da lista simplesmente não é atingido — a resposta diz quantas
 * foram marcadas, sem revelar quais ids existiam.
 */
async function marcarVarias(contexto, ids = []) {
  const escopo = filtroDeEscopo(contexto, 'notificacao.marcar_lida', 'usuario_id');
  if (!escopo) throw negar();

  const alvos = [...new Set(ids)].slice(0, MARCAR_LOTE_MAXIMO);
  if (!alvos.length) return { marcadas: 0 };

  const [marcadas] = await db.Notificacao.update(
    { lida_em: new Date() },
    { where: { ...escopo, id: { [Op.in]: alvos }, lida_em: null } }
  );

  if (marcadas) await avisar(contexto.usuarioId, { ids: alvos });
  return { marcadas };
}

/** "limpar tudo" do sininho: um UPDATE só, nunca um laço de save() */
async function marcarTodas(contexto, { tipo } = {}) {
  const escopo = filtroDeEscopo(contexto, 'notificacao.marcar_lida', 'usuario_id');
  if (!escopo) throw negar();

  /* sem escopo próprio, "todas" seria o sininho do sistema inteiro: mesmo o
     Admin marca só as dele nesta rota */
  const where = { usuario_id: contexto.usuarioId, canal: 'sistema', lida_em: null };
  if (tipo) where.tipo = tipo;

  const [marcadas] = await db.Notificacao.update({ lida_em: new Date() }, { where });

  if (marcadas) await avisar(contexto.usuarioId, { todas: true });
  return { marcadas };
}

module.exports = { marcarUma, marcarVarias, marcarTodas };
