'use strict';

const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const config = require('../../config');
const { erros } = require('../../utils/erros');
const { TIPOS_ACEITOS, MIMES_ACEITOS } = require('./midia.constants');

/**
 * Porteiro do módulo: decide se um buffer pode virar arquivo no disco.
 *
 * Está separado do upload porque é a parte que será auditada e a que precisa
 * ser chamável sem banco, sem storage e sem HTTP — o dia em que a validação
 * for questionada, ela cabe num teste de três linhas.
 *
 * Nada aqui confia no cliente: nem `mimetype`, nem `originalname`, nem o
 * tamanho declarado. Todos os três são texto que o remetente escreve.
 */

/** identifica o tipo REAL pelos primeiros bytes; `null` quando não é aceito */
function identificarTipo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return TIPOS_ACEITOS.find((tipo) => tipo.confere(buffer)) || null;
}

/**
 * Nome enviado pelo cliente, guardado só para exibição.
 *
 * O caminho no disco NUNCA vem daqui — quem gera é `providers/storage`, com
 * UUID. Este valor existe apenas para a tela "foto-do-trator.jpg" fazer
 * sentido para quem enviou, e ainda assim é reduzido ao basename e limpo de
 * caractere de controle: se um dia alguém usar este campo para montar
 * caminho, que o estrago já esteja contido.
 */
function nomeParaExibicao(original) {
  if (!original || typeof original !== 'string') return null;

  const base = path
    .basename(original.replace(/\\/g, '/'))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '')
    .trim();

  if (!base || base === '.' || base === '..') return null;
  return base.slice(0, 200);
}

/**
 * Dimensões lidas do CABEÇALHO, sem decodificar a imagem.
 *
 * É o que permite recusar uma bomba de descompressão de graça: `metadata()`
 * lê o header e devolve largura e altura sem alocar o bitmap. Só depois de
 * passar por aqui é que o job tem permissão de decodificar de verdade.
 */
async function lerDimensoes(buffer) {
  try {
    const meta = await sharp(buffer, { animated: false, failOn: 'error' }).metadata();
    return { largura: meta.width || 0, altura: meta.height || 0, formato: meta.format };
  } catch (erro) {
    throw erros.invalido('Não foi possível ler esta imagem. Envie outro arquivo.', {
      campos: { arquivo: 'Imagem corrompida ou incompleta.' },
    });
  }
}

/**
 * Roda todas as conferências e devolve os metadados confiáveis do arquivo.
 * Lança 422 na primeira reprovação, com mensagem que o formulário pode exibir.
 */
async function inspecionar(arquivo) {
  const buffer = arquivo?.buffer;

  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw erros.validacao({ arquivo: 'Arquivo vazio.' });
  }

  if (buffer.length > config.midia.maxBytesPorArquivo) {
    const mb = Math.floor(config.midia.maxBytesPorArquivo / (1024 * 1024));
    throw erros.validacao({ arquivo: `Cada imagem precisa ter no máximo ${mb}MB.` });
  }

  const tipo = identificarTipo(buffer);
  if (!tipo) {
    /* a mensagem não devolve o que o arquivo REALMENTE é: para quem está
       sondando o servidor, saber que a checagem é por conteúdo e qual
       assinatura foi lida é meio caminho para contorná-la */
    throw erros.validacao({
      arquivo: `Formato não aceito. Envie ${MIMES_ACEITOS.map((m) => m.split('/')[1].toUpperCase()).join(', ')}.`,
    });
  }

  const { largura, altura, formato } = await lerDimensoes(buffer);

  /* o decodificador precisa concordar com a assinatura. Divergência aqui é
     arquivo poliglota — um conteúdo montado para ser lido de dois jeitos
     diferentes conforme quem abre */
  const formatoEsperado = tipo.mime.split('/')[1];
  if (formato && formato !== formatoEsperado) {
    throw erros.validacao({ arquivo: 'Arquivo de imagem inconsistente.' });
  }

  if (!largura || !altura) {
    throw erros.validacao({ arquivo: 'Não foi possível ler as dimensões da imagem.' });
  }

  if (largura > config.midia.maxDimensao || altura > config.midia.maxDimensao) {
    throw erros.validacao({
      arquivo: `A imagem não pode passar de ${config.midia.maxDimensao} pixels de lado.`,
    });
  }

  if (largura * altura > config.midia.maxPixels) {
    const mp = Math.floor(config.midia.maxPixels / 1_000_000);
    throw erros.validacao({ arquivo: `A imagem não pode passar de ${mp} megapixels.` });
  }

  return {
    mime: tipo.mime,
    extensao: tipo.extensao,
    largura,
    altura,
    tamanho: buffer.length,
    /* usado para não guardar duas vezes o mesmo byte a byte */
    hash: crypto.createHash('sha256').update(buffer).digest('hex'),
    nomeOriginal: nomeParaExibicao(arquivo.originalname),
  };
}

module.exports = { inspecionar, identificarTipo, nomeParaExibicao, lerDimensoes };
