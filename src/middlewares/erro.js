'use strict';

const config = require('../config');
const { AppError } = require('../utils/erros');

/**
 * Tradutor final de erro. É o ÚNICO lugar do projeto que decide status e
 * formato de falha — services lançam `AppError` e param de pensar em HTTP.
 *
 * Erro inesperado nunca vaza mensagem interna em produção: nome de coluna e
 * trecho de SQL numa resposta são mapa gratuito para quem está sondando.
 */

/** erro do Sequelize → AppError, para o cliente ver campo e não constraint */
function traduzirSequelize(erro) {
  if (erro.name === 'SequelizeUniqueConstraintError') {
    const campos = {};
    (erro.errors || []).forEach((item) => {
      campos[item.path] = 'Já está em uso.';
    });
    return new AppError('Registro duplicado.', 409, 'CONFLITO', { campos });
  }

  if (erro.name === 'SequelizeValidationError') {
    const campos = {};
    (erro.errors || []).forEach((item) => {
      campos[item.path] = item.message;
    });
    return new AppError('Dados inválidos.', 422, 'VALIDACAO', { campos });
  }

  if (erro.name === 'SequelizeForeignKeyConstraintError') {
    return new AppError('Registro relacionado não encontrado ou em uso.', 409, 'VINCULO_INVALIDO');
  }

  if (erro.name === 'SequelizeDatabaseError' && erro.parent?.code === '23514') {
    return new AppError('Os dados violam uma regra do sistema.', 422, 'REGRA_VIOLADA');
  }

  return null;
}

module.exports = function tratarErro(erro, req, res, _next) {
  let falha = erro instanceof AppError ? erro : traduzirSequelize(erro);

  if (!falha) {
    if (erro.type === 'entity.parse.failed') {
      falha = new AppError('JSON inválido no corpo da requisição.', 400, 'JSON_INVALIDO');
    } else {
      falha = new AppError('Erro interno do servidor.', 500, 'ERRO_INTERNO');
    }
  }

  /* 5xx é problema nosso e precisa aparecer no log com rastro completo;
     4xx é o usuário errando e não polui o log */
  if (falha.statusCode >= 500) {
    console.error(`[erro] ${req.method} ${req.originalUrl}`, {
      requisicaoId: req.contexto?.requisicaoId,
      usuarioId: req.contexto?.usuarioId,
      mensagem: erro.message,
      stack: erro.stack,
    });
  }

  res.status(falha.statusCode).json({
    sucesso: false,
    erro: {
      codigo: falha.code,
      mensagem: falha.mensagemPublica || falha.message,
      ...(falha.detalhe ? { detalhe: falha.detalhe } : {}),
    },
    requisicaoId: req.contexto?.requisicaoId,
    ...(config.app.env !== 'production' && falha.statusCode >= 500
      ? { stack: erro.stack }
      : {}),
  });
};
