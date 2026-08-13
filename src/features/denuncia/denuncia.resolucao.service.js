'use strict';

const db = require('../../models');
const filas = require('../../filas');
const tempoReal = require('../../tempo-real');
const auditoria = require('../auditoria/auditoria.service');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { STATUS_PENDENTES, STATUS_RESOLVIDOS, ENTIDADE } = require('./denuncia.constants');

/**
 * Julgamento da denúncia.
 *
 * Resolver é só o **registro do veredito**: a punição em si (ocultar anúncio,
 * suspender conta) é ação da feature `moderacao`, com sua própria permissão e
 * sua própria auditoria. Manter as duas coisas separadas é o que impede que
 * "arquivar uma denúncia" vire um atalho para banir alguém sem passar por
 * `usuario.banir`.
 *
 * O moderador **não julga denúncia em que é parte** — nem a que ele abriu, nem
 * a que é contra ele. É a regra de ouro do módulo: ninguém se auto-inocenta.
 */

/** todas as denúncias abertas sobre o mesmo alvo, para resolver em lote */
const irmasAbertas = (denuncia, transacao) =>
  db.Denuncia.findAll({
    where: {
      alvo_tipo: denuncia.alvo_tipo,
      alvo_id: denuncia.alvo_id,
      status: STATUS_PENDENTES,
    },
    transaction: transacao,
  });

function garantirImparcialidade(contexto, denuncia) {
  const eu = String(contexto.usuarioId);

  if (String(denuncia.denunciante_id) === eu) {
    throw erros.semPermissao('Você não pode julgar uma denúncia que abriu.', {
      code: 'CONFLITO_DE_INTERESSE',
    });
  }

  if (denuncia.denunciado_id && String(denuncia.denunciado_id) === eu) {
    throw erros.semPermissao('Você não pode julgar uma denúncia contra você.', {
      code: 'CONFLITO_DE_INTERESSE',
    });
  }
}

/**
 * @param dados.status       procedente · improcedente · arquivada
 * @param dados.acaoTomada   providência (vocabulário fechado)
 * @param dados.resolucao    o porquê, obrigatório
 * @param dados.emLote       resolve também as demais denúncias do mesmo alvo
 */
async function resolver(contexto, id, dados) {
  exigir(contexto, 'denuncia.resolver');

  const denuncia = await db.Denuncia.findByPk(id);
  if (!denuncia) throw erros.naoEncontrado('Denúncia');

  if (!STATUS_RESOLVIDOS.includes(dados.status)) {
    throw erros.validacao({ status: 'Desfecho inválido.' });
  }

  if (!dados.resolucao || !String(dados.resolucao).trim()) {
    throw erros.validacao({ resolucao: 'Descreva a decisão.' });
  }

  garantirImparcialidade(contexto, denuncia);

  if (STATUS_RESOLVIDOS.includes(denuncia.status)) {
    throw erros.conflito('Esta denúncia já foi resolvida.');
  }

  const antes = { status: denuncia.status };

  const alteracao = {
    status: dados.status,
    acao_tomada: dados.acaoTomada,
    resolucao: dados.resolucao,
    resolvida_por: contexto.usuarioId,
    resolvida_em: new Date(),
  };

  /* resolver em lote é o caso normal: dez pessoas denunciaram o mesmo anúncio
     e a decisão vale para as dez. Fechar uma a uma faria o moderador repetir
     o mesmo texto dez vezes — e nove denunciantes ficariam sem resposta */
  const afetadas = await db.sequelize.transaction(async (transacao) => {
    const alvos = dados.emLote === false ? [denuncia] : await irmasAbertas(denuncia, transacao);
    const ids = [...new Set([denuncia.id, ...alvos.map((linha) => linha.id)])];

    await db.Denuncia.update(alteracao, { where: { id: ids }, transaction: transacao });

    return db.Denuncia.findAll({ where: { id: ids }, transaction: transacao });
  });

  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: ENTIDADE,
    entidadeId: denuncia.id,
    antes,
    depois: {
      status: dados.status,
      acao_tomada: dados.acaoTomada,
      em_lote: afetadas.length,
    },
    motivo: dados.resolucao,
  });

  /* cada denunciante recebe o desfecho — inclusive quem denunciou junto. Sem
     isso, denunciar parece um formulário que cai no vazio e as pessoas param */
  await Promise.all(
    afetadas
      .filter((linha) => linha.denunciante_id)
      .map((linha) =>
        filas.enfileirar('notificacao.criar', {
          usuarioId: linha.denunciante_id,
          tipo: 'denuncia_resolvida',
          titulo: 'Sua denúncia foi analisada',
          mensagem:
            dados.status === 'procedente'
              ? 'Analisamos sua denúncia e tomamos providências.'
              : 'Analisamos sua denúncia e não identificamos violação das regras.',
          dados: { status: dados.status, acaoTomada: dados.acaoTomada },
          entidade: ENTIDADE,
          entidadeId: linha.id,
          canais: ['sistema', 'email'],
        })
      )
  );

  tempoReal.paraSala(tempoReal.salas.moderacao(), tempoReal.EVENTOS.MODERACAO_PENDENTE, {
    denunciaId: denuncia.id,
    status: dados.status,
    resolvidas: afetadas.length,
  });

  return afetadas.find((linha) => String(linha.id) === String(denuncia.id)) || denuncia;
}

module.exports = { resolver, garantirImparcialidade };
