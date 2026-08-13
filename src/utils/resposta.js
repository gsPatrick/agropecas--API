'use strict';

/**
 * Formato único de resposta. O cliente nunca precisa adivinhar onde está o
 * dado: sucesso sempre em `dados`, erro sempre em `erro`.
 */

const ok = (res, dados, meta) => res.status(200).json({ sucesso: true, dados, ...(meta ? { meta } : {}) });

const criado = (res, dados, meta) => res.status(201).json({ sucesso: true, dados, ...(meta ? { meta } : {}) });

const semConteudo = (res) => res.status(204).send();

const aceito = (res, dados) => res.status(202).json({ sucesso: true, dados });

/**
 * Lista paginada. `meta` traz o suficiente para o front montar a paginação
 * sem recalcular nada.
 */
const paginado = (res, itens, { pagina, porPagina, total }) =>
  res.status(200).json({
    sucesso: true,
    dados: itens,
    meta: {
      pagina,
      porPagina,
      total,
      totalPaginas: Math.max(1, Math.ceil(total / porPagina)),
      temProxima: pagina * porPagina < total,
      temAnterior: pagina > 1,
    },
  });

module.exports = { ok, criado, semConteudo, aceito, paginado };
