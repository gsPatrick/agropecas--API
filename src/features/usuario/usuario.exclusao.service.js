'use strict';

const db = require('../../models');
const config = require('../../config');
const senhaProvider = require('../../providers/senha');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const tempoReal = require('../../tempo-real');
const sessaoService = require('../auth/auth.sessao.service');
const auditoria = require('../auditoria/auditoria.service');
const { MOTIVO_REVOGACAO } = require('./usuario.constants');

/**
 * Exclusão de conta — que neste projeto **não apaga nada**.
 *
 * `documentacao/models/LGPD.md` §2: apagar a linha levaria junto anúncios e
 * conversas da outra parte, que têm interesse legítimo no histórico. O caminho
 * é substituir o dado pessoal e manter o registro:
 *
 *   · nome, e-mail, telefone e WhatsApp viram valores neutros — **na hora**,
 *     porque o direito do titular é imediato e uma anonimização "agendada"
 *     deixaria o dado pessoal vivo enquanto o job não roda;
 *   · `senha_hash` é zerado: a conta deixa de ser acessível;
 *   · `anonimizado_em` marca o quê, e `excluir_definitivamente_em`
 *     (hoje + `LGPD_RETENCAO_DIAS`) marca até quando o registro residual
 *     ainda é guardado para defesa em eventual disputa;
 *   · `removido_em` (soft delete do Sequelize) tira a conta de toda consulta
 *     normal sem destruir a integridade referencial.
 *
 * O descarte definitivo depois do prazo é faxina de manutenção, não deste
 * fluxo — ver pendências em `documentacao/features/Usuario.md`.
 */

/** valores neutros que ainda respeitam as restrições de unicidade da tabela */
function valoresAnonimos(usuario) {
  const marca = String(usuario.id).replace(/-/g, '').slice(0, 12);
  const email = `removido-${marca}@anonimizado.invalido`;

  return {
    nome: 'Usuário removido',
    email,
    email_normalizado: email,
    telefone: null,
    whatsapp: null,
    senha_hash: null,
    status: 'removido',
    motivo_status: null,
    /* observação interna é texto escrito por moderador SOBRE a pessoa: some
       junto, senão a anonimização deixaria o retrato do titular intacto */
    observacoes_internas: null,
    ultimo_login_ip_hash: null,
  };
}

/**
 * @param alvoId  ausente = a própria conta. O titular precisa confirmar a
 *                senha; o Admin agindo sobre terceiro não tem como (e não
 *                deve ter) — para ele, a trava é a permissão + auditoria.
 */
async function excluir(contexto, dados = {}, alvoId) {
  const id = alvoId || contexto.usuarioId;
  const proprio = String(id) === String(contexto.usuarioId);

  exigir(contexto, 'usuario.remover', { donoId: id });

  const usuario = await db.Usuario.findByPk(id, {
    include: [{ model: db.Papel, as: 'papeis', through: { attributes: [] }, attributes: ['id', 'chave'] }],
  });
  if (!usuario) throw erros.naoEncontrado('Usuário');
  if (usuario.anonimizado_em) throw erros.conflito('Esta conta já foi excluída.');

  if (proprio) {
    const confere = await senhaProvider.conferir(dados.senhaAtual, usuario.senha_hash);
    if (!confere) throw erros.validacao({ senhaAtual: 'A senha atual está incorreta.' });
  }

  /* a plataforma não pode ficar sem dono: se este é o último admin, a saída
     dele tem que ser precedida da entrada de outro */
  if ((usuario.papeis || []).some((papel) => papel.chave === 'admin')) {
    const outros = await db.UsuarioPapel.count({
      where: { papel_id: usuario.papeis.find((papel) => papel.chave === 'admin').id },
    });
    if (outros <= 1) {
      throw erros.conflito('Esta é a única conta com papel de admin. Designe outra antes.');
    }
  }

  const anonimos = valoresAnonimos(usuario);
  const retencao = new Date(Date.now() + config.lgpd.retencaoDias * 24 * 60 * 60 * 1000);

  await db.sequelize.transaction(async (transacao) => {
    await usuario.update(
      { ...anonimos, anonimizado_em: new Date(), excluir_definitivamente_em: retencao },
      { transaction: transacao }
    );
    /* soft delete: `removido_em` some com a conta das consultas normais, e o
       registro continua existindo para os anúncios e conversas apontarem */
    await usuario.destroy({ transaction: transacao });
  });

  await sessaoService.encerrarTodas(usuario.id, { motivo: MOTIVO_REVOGACAO.EXCLUSAO });
  tempoReal.paraUsuario(usuario.id, tempoReal.EVENTOS.SESSAO_ENCERRADA, {
    motivo: MOTIVO_REVOGACAO.EXCLUSAO,
  });

  await auditoria.registrar(contexto, {
    acao: 'remover',
    entidade: 'usuarios',
    entidadeId: usuario.id,
    /* o `antes` NÃO leva nome nem e-mail: registrar o dado pessoal na trilha
       desfaria a anonimização que acabou de acontecer */
    antes: { status: usuario.status },
    depois: { status: 'removido', anonimizado: true, excluir_definitivamente_em: retencao },
    motivo: dados.motivo || (proprio ? 'exclusão pedida pelo titular' : 'exclusão administrativa'),
    emNomeDe: proprio ? null : usuario.id,
  });

  return { excluido: true, anonimizado: true, excluirDefinitivamenteEm: retencao };
}

module.exports = { excluir, valoresAnonimos };
