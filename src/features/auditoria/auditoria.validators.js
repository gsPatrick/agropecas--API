'use strict';

const { campos, esquema } = require('../../validacao');
const { ACOES, RECURSOS_ACESSO, POR_PAGINA_MAXIMO, FORMATO_EXPORTACAO } = require('./auditoria.constants');

/**
 * Esquemas da trilha.
 *
 * Só existem filtros POSITIVOS. Não há `excluirAtor` nem equivalente, e essa
 * ausência é a regra de segurança principal do módulo: um administrador não
 * pode estreitar a trilha até sumir com as próprias linhas. Os nomes que
 * alguém tentaria (`excluirAtor`, `naoAtorId`…) são recusados explicitamente
 * no service — ver `FILTROS_PROIBIDOS` em `auditoria.constants.js`.
 */

const identificador = esquema({ id: campos.uuid().obrigatorio() });

const filtros = esquema({
  atorId: campos.uuid(),
  emNomeDe: campos.uuid(),
  acao: campos.umDe(ACOES),
  entidade: campos.texto().max(60),
  entidadeId: campos.uuid(),
  de: campos.data(),
  ate: campos.data(),
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(POR_PAGINA_MAXIMO),
});

const daEntidade = esquema({
  entidade: campos.texto().obrigatorio().max(60),
  entidadeId: campos.uuid().obrigatorio(),
});

const paginacao = esquema({
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(POR_PAGINA_MAXIMO),
});

const acessos = esquema({
  titularId: campos.uuid(),
  atorId: campos.uuid(),
  recurso: campos.umDe(RECURSOS_ACESSO),
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(POR_PAGINA_MAXIMO),
});

const exportar = esquema({
  atorId: campos.uuid(),
  acao: campos.umDe(ACOES),
  entidade: campos.texto().max(60),
  entidadeId: campos.uuid(),
  de: campos.data(),
  ate: campos.data(),
  formato: campos.umDe(FORMATO_EXPORTACAO).padrao('json'),
  motivo: campos.texto().obrigatorio('Registre o motivo da exportação.').min(5).max(255),
});

const tokenDownload = esquema({ token: campos.texto().obrigatorio().min(20).max(120) });

module.exports = { identificador, filtros, daEntidade, paginacao, acessos, exportar, tokenDownload };
