'use strict';

const { Op } = require('sequelize');
const { normalizar, slugify } = require('../../utils/texto');
const { erros } = require('../../utils/erros');

/**
 * Peças que os quatro assuntos do catálogo usam igual.
 *
 * Não é um service: não tem regra de negócio nem toca em contexto. É a cola
 * que evita escrever quatro vezes a mesma geração de slug — e quatro vezes a
 * mesma chance de escrever diferente.
 */

/**
 * Slug único, respeitando registro soft-deleted.
 *
 * As tabelas do catálogo são `paranoid`, mas a unicidade de `slug` é
 * restrição do Postgres e não enxerga `removido_em`: um registro apagado
 * continua ocupando o slug. Consultar com `paranoid: false` evita o 500 por
 * violação de unique que só apareceria depois que alguém apagasse algo.
 */
async function slugUnico(Model, nome, { ignorarId } = {}) {
  const raiz = slugify(nome);
  if (!raiz) throw erros.invalido('Não foi possível gerar um identificador a partir deste nome.');

  const where = { slug: { [Op.like]: `${raiz}%` } };
  if (ignorarId) where.id = { [Op.ne]: ignorarId };

  const existentes = await Model.findAll({
    where,
    attributes: ['slug'],
    paranoid: false,
    raw: true,
  });

  const ocupados = new Set(existentes.map((linha) => linha.slug));
  if (!ocupados.has(raiz)) return raiz;

  /* sufixo numérico em vez de hash aleatório: o slug entra na URL pública e
     "bombas-hidraulicas-2" é legível, "bombas-hidraulicas-a91f" não */
  for (let sufixo = 2; sufixo < 1000; sufixo += 1) {
    const candidato = `${raiz}-${sufixo}`;
    if (!ocupados.has(candidato)) return candidato;
  }

  throw erros.conflito('Já existem registros demais com este nome.');
}

/**
 * Fragmento de `where` para busca por nome sem acento.
 *
 * A coluna `*_normalizado` já é gravada minúscula e sem acento, então um
 * `LIKE` simples resolve — não é preciso chamar `unaccent()` na consulta, o
 * que impediria o índice de ser usado. Máquina tem índice trigrama em
 * `modelo_normalizado`, que atende também o `%termo%`; nos demais o índice é
 * btree e cobre bem o caso de prefixo, que é o que o autocomplete faz.
 */
function filtroBusca(coluna, termo) {
  const alvo = normalizar(termo || '');
  if (alvo.length < 2) return null;
  return { [coluna]: { [Op.like]: `%${alvo}%` } };
}

/**
 * Traduz violação de unicidade do Postgres em 409 com mensagem de gente.
 *
 * Sem isto, cadastrar "Bosch" duas vezes devolveria 500 e o Admin não teria
 * como saber que o problema é o nome repetido.
 */
function conflitoDeNome(erro, rotulo) {
  if (erro?.name === 'SequelizeUniqueConstraintError') {
    return erros.conflito(`Já existe ${rotulo} com este nome.`, {
      campos: (erro.errors || []).map((item) => item.path),
    });
  }
  return erro;
}

/** roda a operação traduzindo o unique do banco; devolve o resultado */
async function comConflitoTratado(rotulo, operacao) {
  try {
    return await operacao();
  } catch (erro) {
    throw conflitoDeNome(erro, rotulo);
  }
}

/** só as chaves presentes no corpo entram no update — `undefined` não apaga campo */
function somenteInformados(corpo, mapa) {
  const mudancas = {};
  Object.entries(mapa).forEach(([campoEntrada, colunaBanco]) => {
    if (corpo[campoEntrada] !== undefined) mudancas[colunaBanco] = corpo[campoEntrada];
  });
  return mudancas;
}

module.exports = { slugUnico, filtroBusca, conflitoDeNome, comConflitoTratado, somenteInformados, normalizar };
