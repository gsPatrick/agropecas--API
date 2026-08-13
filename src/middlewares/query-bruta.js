'use strict';

/**
 * Guarda a query como ela chegou, antes de `validar.query` a substituir.
 *
 * `validar.query` troca `req.query` pelo objeto limpo e **descarta campo
 * desconhecido em silêncio** — comportamento correto contra mass assignment,
 * e perigoso em um lugar específico: a trilha de auditoria.
 *
 * Um `?excluirAtor=<eu>` sumiria sem deixar rastro e o cliente acharia que
 * funcionou. Com a cópia crua em `req.queryBruta`, o service consegue recusar
 * com 422 explícito em vez de devolver uma trilha silenciosamente filtrada por
 * quem está sendo auditado.
 *
 * Use nas rotas onde "o campo não existe" precisa virar erro, não omissão.
 */
module.exports = function queryBruta(req, res, next) {
  req.queryBruta = { ...req.query };

  /* nome antigo mantido: a feature `auditoria` já lê `originalQuery` e trocar
     as duas coisas no mesmo passo esconderia qual delas quebrou */
  req.originalQuery = req.queryBruta;
  next();
};
