'use strict';

const db = require('../../models');
const { Op } = require('sequelize');
const { erros } = require('../../utils/erros');
const { normalizar } = require('../../utils/texto');
const { MAXIMO_CULTURAS } = require('./perfil.constants');

/**
 * Culturas do produtor — o que ele planta ou cria.
 *
 * A tela manda a lista de RÓTULOS ("Soja", "Milho safrinha"), porque é o que
 * ela já exibe nas fichas. Aceitar só UUID obrigaria o front a manter um mapa
 * rótulo→id que já existe do lado do servidor, e um vocabulário mantido em dois
 * lugares diverge no primeiro item novo. Por isso `resolver` aceita as três
 * formas: uuid, slug e nome — a comparação por nome é normalizada, senão
 * "Algodão" e "algodao" seriam culturas diferentes.
 *
 * Cultura desconhecida é ERRO, não criação silenciosa: se qualquer texto virasse
 * linha nova em `culturas`, o vocabulário fechado deixaria de ser fechado em uma
 * semana — que é exatamente o problema que a tabela existe para evitar.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rótulos/slugs/ids → registros do catálogo, em UMA consulta.
 *
 * Buscar item a item aqui seria N+1 numa lista de até onze itens vinda de um
 * formulário — barato hoje, e o mesmo laço que aparece na revisão do módulo
 * seguinte com quinhentos.
 */
async function resolver(entradas) {
  const limpos = [...new Set((entradas || []).map((valor) => String(valor).trim()).filter(Boolean))];
  if (!limpos.length) return [];

  const ids = limpos.filter((valor) => UUID.test(valor));
  const textos = limpos.filter((valor) => !UUID.test(valor));

  const culturas = await db.Cultura.findAll({
    where: {
      ativo: true,
      [Op.or]: [
        ...(ids.length ? [{ id: ids }] : []),
        ...(textos.length ? [{ slug: textos.map((texto) => normalizar(texto)) }] : []),
        ...(textos.length ? [{ nome_normalizado: textos.map((texto) => normalizar(texto)) }] : []),
      ],
    },
    attributes: ['id', 'nome', 'slug', 'nome_normalizado'],
  });

  /* índice em memória para conferir o que NÃO foi encontrado — a mensagem
     precisa dizer qual item falhou, senão a pessoa reenvia a lista inteira às
     cegas */
  const porChave = new Map();
  culturas.forEach((cultura) => {
    porChave.set(String(cultura.id), cultura);
    porChave.set(cultura.slug, cultura);
    porChave.set(cultura.nome_normalizado, cultura);
  });

  const naoEncontrados = limpos.filter(
    (valor) => !porChave.has(valor) && !porChave.has(normalizar(valor))
  );

  if (naoEncontrados.length) {
    throw erros.validacao({
      culturas: `Cultura não reconhecida: ${naoEncontrados.join(', ')}.`,
    });
  }

  /* mantém a ordem em que a pessoa marcou: a primeira é a candidata natural a
     "principal" quando a tela ainda não pergunta qual é */
  const vistos = new Set();
  return limpos
    .map((valor) => porChave.get(valor) || porChave.get(normalizar(valor)))
    .filter((cultura) => {
      if (vistos.has(cultura.id)) return false;
      vistos.add(cultura.id);
      return true;
    });
}

/**
 * Sincroniza o conjunto: adiciona o que veio, remove o que saiu.
 *
 * Não é "apaga tudo e reinsere". Preservar a linha existente mantém
 * `criado_em` e os extras (`area_hectares`, `principal`) de quem continuou na
 * lista — recriar zeraria dado que o usuário não pediu para mudar.
 *
 * Roda dentro da transação do chamador quando existe: culturas e maquinário
 * chegam no mesmo PATCH, e salvar metade é pior do que não salvar.
 */
async function sincronizar(perfil, entradas, { transacao } = {}) {
  const culturas = await resolver(entradas);

  if (culturas.length > MAXIMO_CULTURAS) {
    throw erros.validacao({ culturas: `No máximo ${MAXIMO_CULTURAS} culturas.` });
  }

  const desejados = culturas.map((cultura) => cultura.id);

  const atuais = await db.PerfilCultura.findAll({
    where: { perfil_id: perfil.id },
    attributes: ['id', 'cultura_id'],
    transaction: transacao,
  });

  const atuaisIds = atuais.map((linha) => linha.cultura_id);
  const aRemover = atuais.filter((linha) => !desejados.includes(linha.cultura_id));
  const aAdicionar = desejados.filter((id) => !atuaisIds.includes(id));

  if (aRemover.length) {
    await db.PerfilCultura.destroy({
      where: { id: aRemover.map((linha) => linha.id) },
      transaction: transacao,
    });
  }

  if (aAdicionar.length) {
    await db.PerfilCultura.bulkCreate(
      aAdicionar.map((culturaId) => ({
        perfil_id: perfil.id,
        cultura_id: culturaId,
        /* a primeira marcada vira principal só quando não havia nenhuma: a
           tela ainda não pergunta, e sobrescrever a escolha de quem já definiu
           seria decidir por ele */
        principal: !atuais.length && culturaId === desejados[0],
      })),
      { transaction: transacao }
    );
  }

  /* `total_produtores` é coluna e não COUNT(*) por requisição: só o delta é
     escrito, e num UPDATE atômico para não perder concorrência */
  if (aAdicionar.length) {
    await db.Cultura.increment('total_produtores', {
      by: 1,
      where: { id: aAdicionar },
      transaction: transacao,
    });
  }

  if (aRemover.length) {
    await db.Cultura.increment('total_produtores', {
      by: -1,
      where: { id: aRemover.map((linha) => linha.cultura_id) },
      transaction: transacao,
    });
  }

  return { adicionadas: aAdicionar.length, removidas: aRemover.length };
}

/** as culturas do perfil, para a tela de edição */
const listar = (perfilId) =>
  db.Cultura.findAll({
    attributes: ['id', 'nome', 'slug', 'grupo'],
    include: [
      {
        model: db.Perfil,
        as: 'perfis',
        attributes: [],
        through: { attributes: [] },
        where: { id: perfilId },
        required: true,
      },
    ],
    order: [['ordem', 'ASC']],
  });

module.exports = { sincronizar, resolver, listar };
