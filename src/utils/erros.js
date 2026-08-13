'use strict';

/**
 * AppError — erro com contrato estável para o cliente.
 *
 * `code` é string fixa (SENHA_INVALIDA), não texto: o front decide o que
 * mostrar sem depender da mensagem, que pode mudar. `statusCode` é o HTTP.
 * `detalhe` carrega contexto estruturado (campo inválido, permissão exigida).
 */
class AppError extends Error {
  constructor(mensagem, statusCode = 400, code = 'ERRO', detalhe = undefined) {
    super(mensagem);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.detalhe = detalhe;
    this.esperado = true; // distingue erro de negócio de bug
    Error.captureStackTrace(this, this.constructor);
  }
}

const erros = {
  /** 400 — requisição malformada */
  invalido: (mensagem = 'Requisição inválida.', detalhe) =>
    new AppError(mensagem, 400, 'REQUISICAO_INVALIDA', detalhe),

  /** 401 — não autenticado */
  naoAutenticado: (mensagem = 'É preciso estar autenticado.', code = 'NAO_AUTENTICADO') =>
    new AppError(mensagem, 401, code),

  /** 403 — autenticado, mas sem permissão */
  semPermissao: (mensagem = 'Você não tem permissão para esta ação.', detalhe) =>
    new AppError(mensagem, 403, 'SEM_PERMISSAO', detalhe),

  /** 404 */
  naoEncontrado: (recurso = 'Recurso') =>
    new AppError(`${recurso} não encontrado.`, 404, 'NAO_ENCONTRADO'),

  /** 409 — conflito de estado (e-mail já usado, slug duplicado) */
  conflito: (mensagem = 'Já existe um registro com estes dados.', detalhe) =>
    new AppError(mensagem, 409, 'CONFLITO', detalhe),

  /** 422 — validação de campo */
  validacao: (campos) =>
    new AppError('Alguns campos precisam de atenção.', 422, 'VALIDACAO', { campos }),

  /** 429 — limite de tentativas */
  muitasTentativas: (mensagem = 'Muitas tentativas. Tente novamente em instantes.', detalhe) =>
    new AppError(mensagem, 429, 'MUITAS_TENTATIVAS', detalhe),

  /** 423 — conta bloqueada/suspensa */
  contaBloqueada: (mensagem, detalhe) =>
    new AppError(mensagem, 423, 'CONTA_BLOQUEADA', detalhe),

  /** 500 explícito, para falha de dependência externa */
  interno: (mensagem = 'Erro interno do servidor.', detalhe) =>
    new AppError(mensagem, 500, 'ERRO_INTERNO', detalhe),
};

module.exports = { AppError, erros };
