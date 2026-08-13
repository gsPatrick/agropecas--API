'use strict';

const crypto = require('crypto');
const { hashIp } = require('../utils/hash');

/**
 * Primeiro middleware da pilha. Monta `req.contexto` — o objeto que todo
 * service recebe no lugar de `req`.
 *
 * Por que services não recebem `req`: quem recebe `req` acaba lendo header,
 * query e cookie no meio da regra de negócio, e a regra deixa de ser testável
 * fora do HTTP. O contexto é o contrato entre camadas.
 *
 * Aqui ele nasce anônimo. `autenticar` preenche usuário e permissões depois.
 */
module.exports = function contexto(req, res, next) {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    null;

  const requisicaoId = req.headers['x-request-id'] || crypto.randomUUID();

  req.contexto = {
    requisicaoId,
    usuario: null,
    usuarioId: null,
    sessaoId: null,
    papeis: [],
    permissoes: new Set(),
    admin: false,
    autenticado: false,

    /* IP em claro fica só na requisição, para rate-limit em memória.
       O que vai para o banco é sempre o hash (LGPD). */
    ip,
    ipHash: hashIp(ip),
    userAgent: (req.headers['user-agent'] || '').slice(0, 500),
    origem: req.headers['x-origem'] || 'web',
  };

  /* devolvido no header para o suporte cruzar log e reclamação do usuário */
  res.setHeader('X-Request-Id', requisicaoId);
  next();
};
