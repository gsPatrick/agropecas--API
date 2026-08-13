'use strict';

const { campos, esquema } = require('../../validacao');
const { DENUNCIA_ALVO, DENUNCIA_STATUS } = require('../../models/constantes');
const { MOTIVOS, STATUS_RESOLVIDOS, ACOES_TOMADAS } = require('./denuncia.constants');

/**
 * Esquemas de entrada.
 *
 * Compilados uma vez no carregamento do módulo. `alvoTipo` sai do enum do
 * model e não de uma lista escrita à mão: o dia em que a migration ganhar um
 * alvo novo, a API aceita sem ninguém lembrar deste arquivo.
 */

const identificador = esquema({ id: campos.uuid().obrigatorio('Identificador inválido.') });

const criar = esquema({
  alvoTipo: campos.umDe(DENUNCIA_ALVO).obrigatorio('Informe o que está sendo denunciado.').rotulo('tipo de alvo'),
  alvoId: campos.uuid().obrigatorio('Informe o registro denunciado.'),
  motivo: campos.umDe(MOTIVOS).obrigatorio('Escolha o motivo da denúncia.'),
  /* a descrição é o que o moderador lê primeiro; opcional porque exigir texto
     em denúncia de spam só faria a pessoa escrever "spam" de novo */
  descricao: campos.textoLongo().max(2000),
  evidenciaUrl: campos.texto().max(500),
});

const listar = esquema({
  status: campos.umDe(DENUNCIA_STATUS),
  alvoTipo: campos.umDe(DENUNCIA_ALVO),
  motivo: campos.umDe(MOTIVOS),
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
});

const agrupadas = esquema({
  alvoTipo: campos.umDe(DENUNCIA_ALVO),
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
});

/**
 * Resolver. `resolucao` é obrigatória: julgar sem escrever o porquê deixa o
 * histórico com um veredito sem argumento — e é exatamente esse texto que o
 * suporte usa quando o denunciado reclama.
 */
const resolver = esquema({
  status: campos.umDe(STATUS_RESOLVIDOS).obrigatorio('Informe o desfecho da denúncia.'),
  acaoTomada: campos.umDe(ACOES_TOMADAS).obrigatorio('Informe a providência tomada.'),
  resolucao: campos.textoLongo().obrigatorio('Descreva a decisão.').min(5).max(2000),
});

module.exports = { identificador, criar, listar, agrupadas, resolver };
