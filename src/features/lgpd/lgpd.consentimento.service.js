'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const documentoService = require('./lgpd.documento.service');
const { TIPOS_DOCUMENTO_COM_CONSENTIMENTO } = require('./lgpd.constants');

/**
 * Visão do TITULAR sobre os próprios consentimentos.
 *
 * Quem GRAVA consentimento é `features/auth/auth.consentimento.service.js` —
 * ele nasceu lá porque o primeiro aceite acontece no cadastro, e duplicar a
 * escrita aqui garantiria que um dia as duas divergissem sobre qual base legal
 * atribuir. Este arquivo só lê, e responde uma pergunta que a tela de perfil
 * não responde: "a que eu disse sim, quando, e o que mudou desde então?".
 */

/**
 * Estado atual + histórico, num par de consultas.
 *
 * O estado atual é derivado do histórico (a linha mais recente de cada tipo),
 * nunca de um booleano guardado à parte: dois lugares afirmando a mesma coisa
 * viram dois lugares se contradizendo.
 */
async function meus(usuarioId, { incluirHistorico = true } = {}) {
  const [linhas, pendencias] = await Promise.all([
    db.Consentimento.findAll({
      where: { usuario_id: usuarioId },
      attributes: [
        'id', 'tipo', 'aceito', 'versao_documento', 'base_legal',
        'finalidade', 'origem', 'revogado_em', 'criado_em',
      ],
      order: [['criado_em', 'DESC']],
      limit: 500,
    }),
    documentoService.pendenciasDeAceite(usuarioId),
  ]);

  const atual = {};
  linhas.forEach((linha) => {
    if (!atual[linha.tipo]) atual[linha.tipo] = linha;
  });

  const desatualizados = new Set(pendencias.pendentes.map((item) => item.tipo));

  return {
    atuais: Object.values(atual).map((linha) => ({
      registro: linha,
      desatualizado: desatualizados.has(linha.tipo),
    })),
    historico: incluirHistorico ? linhas : [],
    pendentes: pendencias.pendentes,
    precisaReaceitar: pendencias.bloqueia,
  };
}

/**
 * Titulares com consentimento desatualizado, para o painel do encarregado.
 *
 * Não é curiosidade de produto: se a Política mudou e metade da base nunca
 * reaceitou, a plataforma está tratando dado dessa metade sob um documento que
 * ninguém leu — e quem responde por isso é a controladora.
 */
async function totalDesatualizados() {
  const vigentes = await documentoService.vigentes();
  const contagem = {};

  /* uma vez só, fora do laço: o total de contas ativas não depende do
     documento, e contá-lo por tipo era três varreduras da tabela de usuários
     para chegar sempre ao mesmo número */
  const ativos = await db.Usuario.count({
    where: { anonimizado_em: null, status: { [Op.in]: ['ativo', 'pendente'] } },
  });

  await Promise.all(
    Object.values(vigentes).map(async (documento) => {
      /**
       * Documento sem par no enum de consentimento (hoje `politica_cookies`):
       * não há linha para contar, e perguntar por ele ao Postgres derrubava a
       * requisição com 500. Devolvemos a linha com o aceite marcado como não
       * rastreado — omitir o documento faria a tela do admin esconder que ele
       * existe, que é pior do que dizer que não sabemos contar o aceite.
       */
      if (!TIPOS_DOCUMENTO_COM_CONSENTIMENTO.includes(documento.tipo)) {
        contagem[documento.tipo] = {
          versaoVigente: documento.versao,
          aceitaramVersaoVigente: null,
          contasAtivas: ativos,
          desatualizados: 0,
          aceiteRastreado: false,
        };
        return;
      }

      /* quem NÃO tem nenhuma linha aceita na versão vigente — subconsulta em
         vez de trazer os ids para a aplicação e comparar aqui */
      const naVersao = await db.Consentimento.count({
        where: {
          tipo: documento.tipo,
          aceito: true,
          revogado_em: null,
          versao_documento: documento.versao,
        },
        distinct: true,
        col: 'usuario_id',
      });

      contagem[documento.tipo] = {
        versaoVigente: documento.versao,
        aceitaramVersaoVigente: naVersao,
        contasAtivas: ativos,
        desatualizados: Math.max(0, ativos - naVersao),
        aceiteRastreado: true,
      };
    })
  );

  return contagem;
}

module.exports = { meus, totalDesatualizados };
