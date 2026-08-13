'use strict';

const { exigir } = require('../rbac');

/**
 * Ponte HTTP → RBAC. Não decide nada: quem decide é `src/rbac/autorizacao.js`.
 *
 *   router.get('/', autorizar('anuncio.ler'), ctrl.listar);
 *
 * Só cobre a **capacidade**. O escopo (`.proprio` × `.todos`) depende do dono
 * do registro, que só é conhecido depois de buscar no banco — por isso a
 * verificação de escopo mora no service, com `exigir(ctx, acao, { donoId })`.
 * Middleware que fingisse checar escopo daria falsa sensação de proteção.
 */
const autorizar = (...acoes) => (req, res, next) => {
  try {
    acoes.forEach((acao) => exigir(req.contexto, acao));
    next();
  } catch (erro) {
    next(erro);
  }
};

/** atalho para rota exclusiva de Admin (tela de RBAC, configuração global) */
const somenteAdmin = (req, res, next) => {
  try {
    exigir(req.contexto, 'admin.acessar');
    next();
  } catch (erro) {
    next(erro);
  }
};

module.exports = autorizar;
module.exports.autorizar = autorizar;
module.exports.somenteAdmin = somenteAdmin;
