'use strict';

const { campos, esquema } = require('../../validacao');
const { REFERENCIAS } = require('./midia.constants');

/**
 * Esquemas de entrada.
 *
 * O que chega no multipart junto dos arquivos são campos de texto comuns, e
 * passam pelo mesmo caminho de validação de qualquer outro corpo — o `multer`
 * preenche `req.body` com eles antes de `validar` rodar. É o que impede um
 * `referenciaId` com texto arbitrário chegar à consulta.
 *
 * Os arquivos em si NÃO são validados aqui: o vocabulário de `src/validacao`
 * descreve dado de formulário, não binário, e tipo real de imagem se confere
 * por assinatura de bytes — trabalho de `midia.inspecao.service.js`.
 */

/** vínculo opcional informado já no upload (o front do anúncio manda os dois) */
const upload = esquema({
  referenciaTipo: campos.umDe(REFERENCIAS).rotulo('vínculo'),
  referenciaId: campos.uuid(),
});

const listagem = esquema({
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
  referenciaTipo: campos.umDe(REFERENCIAS).rotulo('vínculo'),
  referenciaId: campos.uuid(),
  /* só o Admin consegue estreitar por outro usuário; para os demais o filtro
     de escopo do RBAC sobrescreve o que for enviado aqui */
  usuarioId: campos.uuid(),
});

const identificador = esquema({ id: campos.uuid().obrigatorio('Identificador inválido.') });

module.exports = { upload, listagem, identificador };
