'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const { CONSENTIMENTOS_OBRIGATORIOS } = require('./auth.constants');

/**
 * Registro de consentimento (LGPD art. 8º, §1º: o consentimento precisa ser
 * **demonstrável** pelo controlador).
 *
 * A tabela é HISTÓRICO IMUTÁVEL: revogar não apaga a linha, cria `revogado_em`.
 * Apagar o aceite destruiria justamente a prova que a lei exige guardar.
 *
 * Cada linha guarda a versão do documento aceita — quando os Termos mudarem,
 * dá para saber quem aceitou qual texto, e quem precisa reaceitar.
 */

/**
 * Versão vigente de cada documento legal publicado.
 *
 * Vigência é um INTERVALO (`vigente_de` … `vigente_ate`), não uma bandeira:
 * publicar a versão nova precisa poder ser agendado sem invalidar a atual no
 * mesmo instante.
 *
 * Sem `catch` silencioso de propósito. A versão anterior engolia o erro e
 * devolvia `{}`, o que fazia todo consentimento ser gravado sem
 * `documento_legal_id` nem `versao_documento` — ou seja, sem a prova de QUAL
 * texto a pessoa aceitou, que é exatamente o que o art. 8º, §1º da LGPD exige
 * do controlador. Falha aqui precisa aparecer.
 */
async function documentosVigentes() {
  const agora = new Date();

  const documentos = await db.DocumentoLegal.findAll({
    where: {
      vigente_de: { [Op.lte]: agora },
      [Op.or]: [{ vigente_ate: null }, { vigente_ate: { [Op.gt]: agora } }],
    },
    order: [['vigente_de', 'DESC']],
  });

  const porTipo = {};
  documentos.forEach((documento) => {
    if (!porTipo[documento.tipo]) porTipo[documento.tipo] = documento;
  });
  return porTipo;
}

/**
 * @param {object[]} itens  [{ tipo, aceito, finalidade }]
 * @param {object} opcoes   `origem` diz ONDE o aceite foi colhido (cadastro,
 *                          tela de perfil, ação do Admin) — a LGPD exige saber
 *                          o contexto da coleta, não só que houve coleta
 */
async function registrar(usuarioId, itens = [], contexto, { origem = 'cadastro', transacao } = {}) {
  if (!itens.length) return [];

  const vigentes = await documentosVigentes();

  const linhas = itens.map((item) => {
    const documento = vigentes[item.tipo];
    return {
      usuario_id: usuarioId,
      tipo: item.tipo,
      aceito: item.aceito !== false,
      documento_legal_id: documento?.id || null,
      versao_documento: documento?.versao || null,
      /* obrigatório é execução de contrato; opcional é consentimento puro —
         a base legal muda o que o titular pode exigir depois */
      base_legal: CONSENTIMENTOS_OBRIGATORIOS.includes(item.tipo)
        ? 'execucao_contrato'
        : 'consentimento',
      finalidade: item.finalidade || null,
      origem,
      ip_hash: contexto?.ipHash || null,
      user_agent: contexto?.userAgent || null,
    };
  });

  return db.Consentimento.bulkCreate(linhas, { transaction: transacao });
}

/** revoga sem apagar: nova linha marcada, histórico preservado */
async function revogar(usuarioId, tipo, contexto, { origem = 'perfil' } = {}) {
  await db.Consentimento.update(
    { revogado_em: new Date() },
    { where: { usuario_id: usuarioId, tipo, revogado_em: null } }
  );

  return registrar(usuarioId, [{ tipo, aceito: false }], contexto, { origem });
}

const listar = (usuarioId) =>
  db.Consentimento.findAll({
    where: { usuario_id: usuarioId },
    order: [['criado_em', 'DESC']],
  });

module.exports = { registrar, revogar, listar, documentosVigentes };
