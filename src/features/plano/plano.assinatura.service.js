'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const auditoria = require('../auditoria/auditoria.service');
const consultaService = require('./plano.consulta.service');
const usoService = require('./plano.uso.service');
const { erros } = require('../../utils/erros');
const { invalidarUsuario } = require('./plano.cache');
const { AUDITORIA, STATUS_VIGENTES } = require('./plano.constants');

/**
 * Vínculo usuário × plano.
 *
 * Não há cobrança no MVP (Maturacao/01, §3): atribuir plano é ato
 * administrativo, não compra. Por isso `origem` padrão é `admin` e nenhum
 * campo de gateway é preenchido — `referencia_externa` fica null até existir
 * um provedor, e quando existir será ele quem preenche, não este service.
 */

/**
 * Coloca o usuário num plano.
 *
 * Encerra a assinatura vigente antes de criar a nova, na mesma transação:
 * duas assinaturas ativas fariam `planoEfetivo` escolher pela data de início,
 * e o limite que vale passaria a depender de ordenação em vez de decisão.
 */
async function atribuir({ usuarioId, planoId, planoChave, motivo, origem = 'admin', fimEm = null }, contexto) {
  const usuario = await db.Usuario.findByPk(usuarioId, { attributes: ['id'] });
  if (!usuario) throw erros.naoEncontrado('Usuário');

  const plano = await consultaService.obter(planoId || planoChave);
  if (!plano.ativo) throw erros.invalido('Plano inativo não pode ser atribuído.');

  const anterior = await consultaService.assinaturaVigente(usuarioId);

  const nova = await db.sequelize.transaction(async (transacao) => {
    if (anterior) {
      if (anterior.plano_id === plano.id) {
        /* já está no plano: devolver a mesma assinatura em vez de criar outra
           torna a operação idempotente — o Admin clicar duas vezes não pode
           gerar histórico falso de troca */
        return anterior;
      }

      await anterior.update(
        {
          status: 'cancelada',
          cancelada_em: new Date(),
          cancelamento_motivo: motivo || 'Troca de plano pelo Admin',
        },
        { transaction: transacao }
      );
    }

    return db.Assinatura.create(
      {
        usuario_id: usuarioId,
        plano_id: plano.id,
        status: 'ativa',
        inicio_em: new Date(),
        fim_em: fimEm,
        origem,
      },
      { transaction: transacao }
    );
  });

  await invalidarUsuario(usuarioId);

  /* trocar o plano de alguém muda o que essa pessoa pode fazer: é exatamente
     o tipo de ação que a LGPD e a revisão cobram rastro (RBAC.md §2) */
  await auditoria.registrar(contexto, {
    acao: AUDITORIA.ATRIBUIR,
    entidade: 'assinatura',
    entidadeId: nova.id,
    antes: anterior ? { planoId: anterior.plano_id, status: anterior.status } : null,
    depois: { planoId: plano.id, planoChave: plano.chave, status: nova.status },
    motivo,
    emNomeDe: usuarioId,
  });

  return nova;
}

/**
 * Cancela a assinatura vigente e devolve a pessoa ao plano padrão.
 * Não apaga: o histórico de qual plano valia em cada data é o que sustenta
 * qualquer discussão futura sobre cobrança.
 */
async function cancelar(usuarioId, { motivo } = {}, contexto) {
  const vigente = await consultaService.assinaturaVigente(usuarioId);
  if (!vigente) throw erros.naoEncontrado('Assinatura');

  await vigente.update({
    status: 'cancelada',
    cancelada_em: new Date(),
    cancelamento_motivo: motivo || null,
  });

  await invalidarUsuario(usuarioId);
  await auditoria.registrar(contexto, {
    acao: AUDITORIA.ATRIBUIR,
    entidade: 'assinatura',
    entidadeId: vigente.id,
    antes: { status: 'ativa' },
    depois: { status: 'cancelada' },
    motivo,
    emNomeDe: usuarioId,
  });

  return vigente;
}

/**
 * "Minha assinatura": plano vigente, limites e quanto já foi consumido.
 *
 * Devolve dados mesmo sem assinatura registrada — nesse caso `origem` vem como
 * `padrao` e a tela mostra o plano gratuito, que é a verdade. Um 404 aqui
 * faria a tela sugerir que a conta está sem plano, o que nunca acontece.
 */
async function minha(usuarioId) {
  const [assinatura, consumo] = await Promise.all([
    consultaService.assinaturaVigente(usuarioId),
    usoService.panorama(usuarioId),
  ]);

  return { assinatura, plano: consumo.plano, uso: consumo.itens };
}

/** histórico de planos de um usuário — tela do Admin e do próprio titular */
function historico(usuarioId, { limit = 20, offset = 0 } = {}) {
  return db.Assinatura.findAndCountAll({
    where: { usuario_id: usuarioId },
    include: [{ model: db.Plano, as: 'plano', attributes: ['id', 'chave', 'nome', 'preco_centavos'] }],
    order: [['inicio_em', 'DESC']],
    limit,
    offset,
  });
}

/** assinaturas vigentes de um plano — usado pelo Admin antes de remover */
const contarVigentes = (planoId) =>
  db.Assinatura.count({ where: { plano_id: planoId, status: { [Op.in]: STATUS_VIGENTES } } });

module.exports = { atribuir, cancelar, minha, historico, contarVigentes };
