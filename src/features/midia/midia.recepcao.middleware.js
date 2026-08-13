'use strict';

const multer = require('multer');
const config = require('../../config');
const { erros } = require('../../utils/erros');
const { CAMPOS_ARQUIVO, MIMES_ACEITOS } = require('./midia.constants');

/**
 * Parser do `multipart/form-data`.
 *
 * É middleware e não service porque é puro HTTP: quem transforma o corpo da
 * requisição em buffers não tem lugar na regra de negócio, e o service de
 * upload precisa continuar chamável por um script de importação.
 *
 * **Memória e não disco.** Gravar em `/tmp` para depois ler, processar e
 * apagar significa três passagens pelo disco e um diretório temporário que
 * enche quando um upload falha no meio. Como cada arquivo já é limitado e a
 * quantidade por requisição também, o pior caso de memória é conhecido e
 * pequeno — e o buffer segue direto para a inspeção e para o storage, sem
 * cópia intermediária.
 */

const armazenamento = multer.memoryStorage();

const parser = multer({
  storage: armazenamento,
  limits: {
    /* o corte de tamanho acontece AQUI, durante a leitura do socket: o
       multer aborta ao ultrapassar o limite, então um arquivo de 2GB nunca
       chega a existir inteiro na memória para só depois ser recusado */
    fileSize: config.midia.maxBytesPorArquivo,
    files: config.midia.maxArquivosPorRequisicao,
    /* tetos de forma: sem eles, um multipart com cem mil campos de texto vira
       negação de serviço sem nenhum arquivo envolvido */
    fields: 20,
    parts: config.midia.maxArquivosPorRequisicao + 20,
    fieldSize: 4 * 1024,
    headerPairs: 40,
  },

  /* filtro barato e nada mais: o `mimetype` vem do cliente e serve só para
     evitar ler 8MB de um .zip que já se anuncia como .zip. A decisão de
     verdade é por assinatura de bytes, em midia.inspecao.service.js */
  fileFilter(req, arquivo, callback) {
    if (!CAMPOS_ARQUIVO.includes(arquivo.fieldname)) {
      return callback(erros.validacao({ arquivos: 'Campo de arquivo desconhecido.' }));
    }
    if (arquivo.mimetype && !MIMES_ACEITOS.includes(arquivo.mimetype)) {
      return callback(erros.validacao({ arquivos: 'Formato não aceito. Envie JPEG, PNG ou WebP.' }));
    }
    callback(null, true);
  },
}).fields(CAMPOS_ARQUIVO.map((name) => ({ name, maxCount: config.midia.maxArquivosPorRequisicao })));

/** mensagens do multer viram erro do contrato da API, não 500 */
function traduzir(erro) {
  if (!(erro instanceof multer.MulterError)) return erro;

  const mb = Math.floor(config.midia.maxBytesPorArquivo / (1024 * 1024));

  const mensagens = {
    LIMIT_FILE_SIZE: `Cada imagem precisa ter no máximo ${mb}MB.`,
    LIMIT_FILE_COUNT: `Envie no máximo ${config.midia.maxArquivosPorRequisicao} imagens por vez.`,
    LIMIT_PART_COUNT: 'Requisição com partes demais.',
    LIMIT_FIELD_COUNT: 'Requisição com campos demais.',
    LIMIT_FIELD_VALUE: 'Um dos campos de texto é grande demais.',
    LIMIT_UNEXPECTED_FILE: 'Campo de arquivo desconhecido.',
  };

  return erros.validacao({ arquivos: mensagens[erro.code] || 'Não foi possível ler o envio.' });
}

/** normaliza `req.files` (que o multer entrega por campo) numa lista só */
const receber = (req, res, next) =>
  parser(req, res, (erro) => {
    if (erro) return next(traduzir(erro));

    const porCampo = req.files || {};
    req.arquivosRecebidos = CAMPOS_ARQUIVO.flatMap((campo) => porCampo[campo] || []);
    next();
  });

module.exports = receber;
