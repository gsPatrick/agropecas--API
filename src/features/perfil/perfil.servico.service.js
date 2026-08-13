'use strict';

const db = require('../../models');
const { Op } = require('sequelize');
const { erros } = require('../../utils/erros');
const { normalizar } = require('../../utils/texto');
const { MAXIMO_POR_COLECAO } = require('./perfil.constants');

/**
 * Serviços prestados, sincronizados a partir de uma lista simples.
 *
 * `PUT /perfis/meu/servicos` já existia e faz o mesmo — mas exige o corpo
 * `{ itens: [{ id: uuid }] }`, que é o formato da tela de vínculo com preço e
 * observação. A tela `/painel/servicos` é outra coisa: marca fichas e salva o
 * perfil inteiro num PATCH. Sem este caminho, o prestador salvava a tela e os
 * serviços simplesmente não iam — o cadastro parecia ter funcionado e ele não
 * aparecia em busca nenhuma.
 *
 * Aceita **uuid ou slug** porque o front trabalha com o catálogo público, onde
 * o slug é a chave estável e legível. Nome também resolve: é o que a ficha
 * exibe, e obrigar o front a manter o mapa nome→id duplicaria o catálogo.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** referências → registros do catálogo, em uma consulta só */
async function resolver(entradas) {
  const limpos = [...new Set((entradas || []).map((valor) => String(valor).trim()).filter(Boolean))];
  if (!limpos.length) return [];

  const ids = limpos.filter((valor) => UUID.test(valor));
  const textos = limpos.filter((valor) => !UUID.test(valor)).map((texto) => normalizar(texto));

  const servicos = await db.Servico.findAll({
    where: {
      ativo: true,
      [Op.or]: [
        ...(ids.length ? [{ id: ids }] : []),
        ...(textos.length ? [{ slug: textos }, { nome_normalizado: textos }] : []),
      ],
    },
    attributes: ['id', 'nome', 'slug', 'nome_normalizado'],
  });

  const porChave = new Map();
  servicos.forEach((servico) => {
    porChave.set(String(servico.id), servico);
    porChave.set(servico.slug, servico);
    porChave.set(servico.nome_normalizado, servico);
  });

  const naoEncontrados = limpos.filter(
    (valor) => !porChave.has(valor) && !porChave.has(normalizar(valor))
  );

  /* serviço fora do catálogo é erro e não criação: campo livre é justamente o
     que faria "retífica de cabeçote" e "retificar cabecote" virarem dois
     serviços que não se encontram na busca */
  if (naoEncontrados.length) {
    throw erros.validacao({
      servicos: `Serviço não reconhecido: ${naoEncontrados.join(', ')}.`,
    });
  }

  const vistos = new Set();
  return limpos
    .map((valor) => porChave.get(valor) || porChave.get(normalizar(valor)))
    .filter((servico) => {
      if (vistos.has(servico.id)) return false;
      vistos.add(servico.id);
      return true;
    });
}

/**
 * Adiciona o que veio, remove o que saiu — e **não toca** no que ficou.
 *
 * Apagar tudo e reinserir seria uma linha a menos de código e perderia
 * `preco_referencia_centavos`, `observacao` e `principal`, que o prestador
 * preencheu na outra tela. O usuário marcaria uma ficha nova e veria os preços
 * das outras sumirem sem explicação.
 */
async function sincronizar(perfil, entradas, { transacao } = {}) {
  const servicos = await resolver(entradas);

  if (servicos.length > MAXIMO_POR_COLECAO) {
    throw erros.validacao({ servicos: `No máximo ${MAXIMO_POR_COLECAO} serviços.` });
  }

  const desejados = servicos.map((servico) => String(servico.id));

  const atuais = await db.PerfilServico.findAll({
    where: { perfil_id: perfil.id },
    attributes: ['id', 'servico_id'],
    transaction: transacao,
  });

  const atuaisIds = atuais.map((linha) => String(linha.servico_id));
  const aRemover = atuais.filter((linha) => !desejados.includes(String(linha.servico_id)));
  const aAdicionar = desejados.filter((id) => !atuaisIds.includes(id));

  if (aRemover.length) {
    await db.PerfilServico.destroy({
      where: { id: aRemover.map((linha) => linha.id) },
      transaction: transacao,
    });
  }

  if (aAdicionar.length) {
    await db.PerfilServico.bulkCreate(
      aAdicionar.map((servicoId) => ({ perfil_id: perfil.id, servico_id: servicoId })),
      { transaction: transacao }
    );
  }

  /* `total_prestadores` é coluna do catálogo (PADRAO_MODULO §10.4): só o delta,
     em UPDATE atômico */
  if (aAdicionar.length) {
    await db.Servico.increment('total_prestadores', {
      by: 1,
      where: { id: aAdicionar },
      transaction: transacao,
    });
  }

  if (aRemover.length) {
    await db.Servico.increment('total_prestadores', {
      by: -1,
      where: { id: aRemover.map((linha) => linha.servico_id) },
      transaction: transacao,
    });
  }

  return { adicionados: aAdicionar.length, removidos: aRemover.length };
}

module.exports = { sincronizar, resolver };
