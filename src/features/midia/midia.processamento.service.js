'use strict';

const sharp = require('sharp');
const db = require('../../models');
const config = require('../../config');
const armazenamento = require('./midia.armazenamento.service');
const { VARIANTES, PASTAS, REFERENCIA_VARIANTE } = require('./midia.constants');

/**
 * Geração das variantes — roda no worker, nunca na requisição.
 *
 * Chamado pelo job `midia.processar`. Recebe id e nada mais: um service que
 * dependesse do `req` não poderia ser o corpo de um job, que é exatamente o
 * lugar onde este código precisa rodar.
 *
 * **Idempotência** é requisito, não gentileza: o BullMQ retenta, um deploy no
 * meio do job faz o mesmo trabalho voltar para a fila, e a faxina reenfileira
 * o que ficou pela metade. A garantia aqui é simples — cada rótulo de variante
 * existe no máximo uma vez por original, e o que já existe é pulado. Rodar
 * dez vezes produz o mesmo resultado de rodar uma.
 */

/** rótulo da variante gravado no caminho, que é montado só por este módulo */
const pastaDaVariante = (arquivoId, rotulo) => `${PASTAS.variantes}/${arquivoId}/${rotulo}`;

const rotuloDoCaminho = (caminho) => String(caminho || '').split('/').slice(-2)[0] || null;

/** variantes já existentes de um original, indexadas por rótulo */
async function variantesDe(arquivoIds) {
  const ids = [].concat(arquivoIds);
  if (!ids.length) return new Map();

  const linhas = await db.Arquivo.findAll({
    where: { referencia_tipo: REFERENCIA_VARIANTE, referencia_id: ids },
    attributes: ['id', 'referencia_id', 'path', 'url', 'mime', 'tamanho_bytes'],
    order: [['criado_em', 'ASC']],
  });

  const mapa = new Map(ids.map((id) => [String(id), {}]));

  linhas.forEach((linha) => {
    const rotulo = rotuloDoCaminho(linha.path);
    if (!rotulo) return;
    const balde = mapa.get(String(linha.referencia_id)) || {};
    balde[rotulo] = linha;
    mapa.set(String(linha.referencia_id), balde);
  });

  return mapa;
}

/**
 * Produz as variantes que faltam para um original.
 * @returns {{ arquivoId, geradas: string[], reaproveitadas: string[] }}
 */
async function gerarVariantes(arquivoId) {
  const original = await db.Arquivo.findByPk(arquivoId);

  /* arquivo removido entre o enfileiramento e a execução é caso normal, não
     erro: lançar aqui faria a fila retentar um trabalho impossível */
  if (!original || original.referencia_tipo === REFERENCIA_VARIANTE) {
    return { arquivoId, ignorado: true, motivo: 'arquivo inexistente ou já é variante' };
  }

  const existentes = (await variantesDe(original.id)).get(String(original.id)) || {};
  const faltantes = VARIANTES.filter((variante) => !existentes[variante.rotulo]);

  if (!faltantes.length) {
    return { arquivoId, geradas: [], reaproveitadas: Object.keys(existentes) };
  }

  const bytes = await armazenamento.ler(original.path);
  if (!bytes) {
    /* o original sumiu do disco. Retentar não traz de volta; o que resta é
       registrar para que a inconsistência apareça no log e não em produção */
    console.warn('[midia] original ausente no storage', { arquivoId, path: original.path });
    return { arquivoId, ignorado: true, motivo: 'original ausente no storage' };
  }

  const geradas = [];

  for (const variante of faltantes) {
    /* segunda trava contra bomba de descompressão: a inspeção do upload já
       recusou pelo cabeçalho, mas o job também roda sobre arquivo antigo e
       sobre reprocessamento manual, onde aquela conferência não aconteceu */
    const imagem = sharp(bytes, {
      limitInputPixels: config.midia.maxPixels,
      sequentialRead: true,
      animated: false,
      failOn: 'error',
    });

    const resultado = await imagem
      /* o EXIF de orientação é aplicado e descartado junto com o resto dos
         metadados: além de girar a foto certo, some o GPS que celular grava
         por padrão — foto de peça não precisa publicar a coordenada da
         fazenda de quem anunciou */
      .rotate()
      .resize({ width: variante.largura, withoutEnlargement: true })
      .webp({ quality: variante.qualidade, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    const salvo = await armazenamento.salvar(resultado.data, {
      pasta: pastaDaVariante(original.id, variante.rotulo),
      extensao: 'webp',
    });

    geradas.push(
      await db.Arquivo.create({
        usuario_id: original.usuario_id,
        driver: original.driver,
        path: salvo.caminho,
        url: armazenamento.url(salvo.caminho),
        nome_original: original.nome_original,
        mime: 'image/webp',
        tamanho_bytes: resultado.info.size,
        hash_conteudo: null,
        referencia_tipo: REFERENCIA_VARIANTE,
        referencia_id: original.id,
      })
    );
  }

  return {
    arquivoId,
    geradas: geradas.map((linha) => rotuloDoCaminho(linha.path)),
    reaproveitadas: Object.keys(existentes),
  };
}

module.exports = { gerarVariantes, variantesDe, rotuloDoCaminho, pastaDaVariante };
