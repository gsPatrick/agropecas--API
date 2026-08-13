'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const db = require('../../models');
const filas = require('../../filas');
const config = require('../../config');
const auditoria = require('../auditoria/auditoria.service');
const { erros } = require('../../utils/erros');
const { compararSeguro } = require('../../utils/hash');
const { EXPORTACAO_VALIDADE_HORAS } = require('./relatorio.constants');

/**
 * Exportação de relatório.
 *
 * **Nunca no caminho da resposta.** Gerar CSV de um ano de métricas é minutos
 * de banco e megabytes de memória; feito na requisição, ele estoura o timeout
 * do balanceador e, pior, faz o cliente repetir o pedido — cada tentativa
 * abrindo outra consulta pesada. Aqui a rota só ENFILEIRA e devolve 202 com um
 * protocolo; quem trabalha é `src/filas/trabalhos/relatorio.trabalho.js`.
 *
 * O arquivo pronto entra em `arquivos` com `descartar_em` preenchido, e o
 * download sai por link assinado e temporário. Um CSV de relatório contém o
 * retrato do negócio da plataforma inteira — servi-lo por URL estática e
 * eterna seria entregar isso a quem descobrisse o caminho.
 */

const REFERENCIA = 'relatorio_exportacao';

/**
 * Assinatura do link de download.
 *
 * HMAC sobre (arquivoId · usuário · expiração) com o segredo da aplicação. Não
 * é JWT de propósito: não há claim nenhum para carregar, e um token opaco de
 * uso único no tempo é mais simples de invalidar do que um JWT que precisaria
 * de lista de revogação.
 *
 * O usuário entra na assinatura: link vazado não vira download por outra conta.
 */
function assinar(arquivoId, usuarioId, expiraEm) {
  return crypto
    .createHmac('sha256', config.seguranca.jwtSecret)
    .update(`${REFERENCIA}:${arquivoId}:${usuarioId}:${expiraEm}`)
    .digest('base64url');
}

const montarLink = (arquivo, usuarioId) => {
  const expiraEm = new Date(arquivo.descartar_em || Date.now()).getTime();
  return {
    caminho: `/relatorios/exportacoes/${arquivo.id}/baixar`,
    token: assinar(arquivo.id, usuarioId, expiraEm),
    expiraEm: new Date(expiraEm).toISOString(),
  };
};

/**
 * Enfileira a exportação.
 *
 * `escopoUsuarioId` é gravado no job, não lido pelo worker do corpo da
 * requisição: o job precisa reaplicar o MESMO filtro de dono que a consulta
 * online aplicaria, senão a exportação vira o caminho fácil para pegar o que a
 * tela recusa.
 */
async function solicitar(contexto, { relatorio, de, ate, formato = 'csv', escopoUsuarioId = null, filtros = {} }) {
  const protocolo = crypto.randomUUID();

  await filas.enfileirar(
    'relatorio.exportar',
    {
      protocolo,
      relatorio,
      formato,
      de,
      ate,
      filtros,
      solicitanteId: contexto.usuarioId,
      escopoUsuarioId,
    },
    /* chave única pelo conteúdo do pedido: dois cliques no botão de exportar
       geram um arquivo, não dois — e o segundo clique não recomeça a consulta */
    { chaveUnica: `relatorio:${relatorio}:${contexto.usuarioId}:${de}:${ate}:${formato}` }
  );

  await auditoria.registrar(contexto, {
    /* `logs_auditoria.acao` é ENUM: `exportar_dados` é o valor existente que
       cobre "alguém tirou dado da plataforma". A entidade `relatorio` separa
       isto da exportação de dados do titular (LGPD) */
    acao: 'exportar_dados',
    entidade: 'relatorio',
    entidadeId: null,
    depois: { protocolo, relatorio, de, ate, formato, escopoUsuarioId },
  });

  return { protocolo, status: 'na_fila', relatorio, de, ate, formato };
}

/** exportações do próprio usuário que ainda não venceram */
async function listar(usuarioId) {
  const arquivos = await db.Arquivo.findAll({
    where: {
      usuario_id: usuarioId,
      referencia_tipo: REFERENCIA,
      descartar_em: { [Op.gt]: new Date() },
    },
    attributes: ['id', 'nome_original', 'mime', 'tamanho_bytes', 'descartar_em', 'criado_em'],
    order: [['criado_em', 'DESC']],
    limit: 50,
  });

  return arquivos.map((arquivo) => ({
    id: arquivo.id,
    nome: arquivo.nome_original,
    mime: arquivo.mime,
    tamanhoBytes: arquivo.tamanho_bytes,
    geradoEm: arquivo.criado_em,
    link: montarLink(arquivo, usuarioId),
  }));
}

/**
 * Valida o link e devolve o arquivo para download.
 *
 * Três verificações, nessa ordem: existe · é do solicitante · não venceu. O
 * erro é o mesmo nos três casos (404), porque distinguir "não existe" de "não
 * é seu" confirmaria a existência de exportação alheia (padrão §11.5).
 */
async function paraDownload(arquivoId, usuarioId, token) {
  const arquivo = await db.Arquivo.findOne({
    where: { id: arquivoId, referencia_tipo: REFERENCIA },
  });

  const negar = () => erros.naoEncontrado('Exportação');

  if (!arquivo || String(arquivo.usuario_id) !== String(usuarioId)) throw negar();
  if (!arquivo.descartar_em || new Date(arquivo.descartar_em) <= new Date()) throw negar();

  const esperado = assinar(arquivo.id, usuarioId, new Date(arquivo.descartar_em).getTime());
  if (!compararSeguro(esperado, token || '')) throw negar();

  return arquivo;
}

module.exports = { solicitar, listar, paraDownload, montarLink, assinar, REFERENCIA, EXPORTACAO_VALIDADE_HORAS };
