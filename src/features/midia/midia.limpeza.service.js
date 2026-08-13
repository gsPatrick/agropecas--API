'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const config = require('../../config');
const filas = require('../../filas');
const { apagarConjunto } = require('./midia.remocao.service');
const { VARIANTES, REFERENCIA_VARIANTE } = require('./midia.constants');

/**
 * Faxina de mídia — o que roda de madrugada para o storage não virar depósito.
 *
 * O órfão nasce de um comportamento normal: a pessoa escolhe seis fotos, o
 * front sobe as seis enquanto ela preenche o formulário, e então ela desiste
 * ou fecha a aba. As imagens ficam no disco sem anúncio nenhum. Em um
 * classificado de máquinas isso é a maior fonte de custo de storage, e não dá
 * para resolver no momento do upload — no momento do upload ainda não se sabe
 * se aquele anúncio vai existir.
 *
 * A remoção é em DUAS etapas de propósito. Apagar direto ao completar o prazo
 * pegaria o anunciante que subiu a foto, foi almoçar e voltou para terminar o
 * cadastro. A primeira rodada marca `descartar_em`; a segunda, um período
 * depois, executa. Vincular o arquivo a qualquer momento limpa a marca.
 */

const horas = (quantidade) => quantidade * 60 * 60 * 1000;

/** originais sem vínculo, antigos o bastante, ainda não marcados */
async function marcarOrfaos() {
  const corte = new Date(Date.now() - horas(config.midia.orfaoHoras));
  const descartarEm = new Date(Date.now() + horas(config.midia.orfaoCarenciaHoras));

  const [marcados] = await db.Arquivo.update(
    { descartar_em: descartarEm },
    {
      where: {
        referencia_tipo: null,
        referencia_id: null,
        descartar_em: null,
        criado_em: { [Op.lt]: corte },
      },
    }
  );

  return marcados;
}

/**
 * Executa o descarte do que passou da carência.
 * Trabalha em lote limitado: uma faxina que tenta apagar cem mil arquivos numa
 * transação só é uma faxina que nunca termina e segura conexão do banco.
 */
async function descartarMarcados() {
  const candidatos = await db.Arquivo.findAll({
    where: {
      descartar_em: { [Op.lt]: new Date() },
      referencia_id: null,
      referencia_tipo: null,
    },
    order: [['descartar_em', 'ASC']],
    limit: config.midia.orfaosPorRodada,
  });

  let arquivos = 0;

  for (const candidato of candidatos) {
    const resultado = await apagarConjunto(candidato);
    arquivos += resultado.removidos;
  }

  return { originais: candidatos.length, arquivos };
}

/**
 * Reenfileira o que ficou sem variante.
 *
 * O upload responde antes de o processamento acontecer; se o Redis estiver
 * fora nesse instante, ou o worker morrer no meio, o registro fica para
 * sempre em `processando` e a foto aparece pesada no front. Esta varredura é a
 * rede de segurança — e só é possível porque o job é idempotente.
 */
async function reenfileirarPendentes() {
  /* margem de alguns minutos: sem ela, a varredura pegaria upload que acabou
     de chegar e ainda está na fila, dobrando trabalho sem motivo */
  const corte = new Date(Date.now() - 15 * 60 * 1000);

  const pendentes = await db.Arquivo.findAll({
    where: {
      referencia_tipo: { [Op.or]: [{ [Op.is]: null }, { [Op.ne]: REFERENCIA_VARIANTE }] },
      descartar_em: null,
      criado_em: { [Op.lt]: corte },
      id: {
        [Op.notIn]: db.sequelize.literal(
          `(SELECT DISTINCT referencia_id FROM arquivos WHERE referencia_tipo = '${REFERENCIA_VARIANTE}' AND referencia_id IS NOT NULL AND removido_em IS NULL)`
        ),
      },
    },
    attributes: ['id'],
    order: [['criado_em', 'ASC']],
    limit: config.midia.orfaosPorRodada,
  });

  await Promise.all(
    pendentes.map((linha) =>
      filas
        .enfileirar('midia.processar', { arquivoId: linha.id }, { chaveUnica: `midia.processar:${linha.id}` })
        .catch(() => null)
    )
  );

  return { reenfileirados: pendentes.length, variantesEsperadas: VARIANTES.length };
}

module.exports = { marcarOrfaos, descartarMarcados, reenfileirarPendentes };
