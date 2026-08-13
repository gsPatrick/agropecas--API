'use strict';

/**
 * Envolve handler async para que rejeição vire `next(erro)`.
 * Sem isto, um `await` que falha derruba a requisição sem resposta — o cliente
 * fica pendurado até o timeout.
 */
const catchAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = catchAsync;
module.exports.catchAsync = catchAsync;
