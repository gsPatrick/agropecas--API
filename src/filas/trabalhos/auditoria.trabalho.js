'use strict';

const { registrar } = require('../registro');
const { FILAS } = require('../definicoes');

/**
 * Exportação da trilha de auditoria.
 *
 * Fora da rota porque o recorte é escolhido por quem pede: o mesmo endpoint
 * que devolve 300 linhas hoje devolve 300 mil quando a auditoria externa pedir
 * o ano fechado — e é justamente aí que ele não pode falhar.
 *
 * A montagem é INCREMENTAL, bloco a bloco, num array de pedaços. Serializar a
 * consulta inteira de uma vez guardaria a tabela toda em memória duas vezes
 * (objetos + string), que é como um worker de 512MB morre.
 */
const EXPORTAR_TRILHA = registrar(
  'auditoria.exportarTrilha',
  async ({ filtros, formato = 'json', solicitadoPor }) => {
    const db = require('../../models');
    const exportacao = require('../../features/auditoria/auditoria.exportacao.service');
    const link = require('../../features/lgpd/lgpd.link.service');
    const filas = require('../index');

    const pedacos = [];
    let linhas = 0;

    if (formato === 'csv') {
      pedacos.push(`${exportacao.cabecalhoCsv()}\n`);
      linhas = await exportacao.percorrer(filtros, async (bloco) => {
        pedacos.push(`${bloco.map(exportacao.linhaCsv).join('\n')}\n`);
      });
    } else {
      pedacos.push('{"trilha":[');
      linhas = await exportacao.percorrer(filtros, async (bloco, primeiro) => {
        const corpo = bloco.map((registro) => JSON.stringify(registro)).join(',');
        pedacos.push(primeiro ? corpo : `,${corpo}`);
      });
      pedacos.push(']}');
    }

    const conteudo = Buffer.from(pedacos.join(''), 'utf8');
    const extensao = formato === 'csv' ? 'csv' : 'json';

    const { caminho } = await link.guardar(conteudo, { pasta: 'auditoria/exportacoes', extensao });

    const { url, expiraEm } = await link.criar({
      caminho,
      /* só quem pediu resgata: o pacote da trilha descreve o comportamento de
         muita gente e não pode circular por link repassável */
      donoId: solicitadoPor,
      nomeArquivo: `trilha-auditoria-${new Date().toISOString().slice(0, 10)}.${extensao}`,
      mime: formato === 'csv' ? 'text/csv; charset=utf-8' : 'application/json',
      rota: '/v1/auditoria/downloads',
    });

    await db.Arquivo.create({
      usuario_id: solicitadoPor || null,
      driver: 'local',
      path: caminho,
      url,
      mime: formato === 'csv' ? 'text/csv' : 'application/json',
      tamanho_bytes: conteudo.length,
      referencia_tipo: 'auditoria_exportacao',
      descartar_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const solicitante = solicitadoPor
      ? await db.Usuario.findByPk(solicitadoPor, { attributes: ['nome', 'email'] })
      : null;

    if (solicitante?.email) {
      await filas.enfileirar('email.enviar', {
        para: solicitante.email,
        assunto: 'Exportação da trilha de auditoria — AgroPeças MT',
        texto:
          `A exportação que você pediu está pronta (${linhas} registros):\n${url}\n\n` +
          `O link vale até ${new Date(expiraEm).toLocaleString('pt-BR')}, funciona uma única vez ` +
          `e só abre com a sua conta autenticada.`,
      });
    }

    return { exportado: true, linhas, formato, tamanhoBytes: conteudo.length };
  },
  { fila: FILAS.MANUTENCAO.nome }
);

module.exports = { EXPORTAR_TRILHA };
