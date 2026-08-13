'use strict';

const db = require('../../models');
const { erros } = require('../../utils/erros');
const { normalizar } = require('../../utils/texto');
const { MAXIMO_MAQUINAS } = require('./perfil.constants');

/**
 * Maquinário do produtor.
 *
 * O centro da tela `/painel/propriedade` — e o que transforma "bomba
 * hidráulica" de busca cega em busca útil: sabendo que a fazenda tem um John
 * Deere 6110J 2018, dá para apontar a peça compatível.
 *
 * A REGRA QUE MANDA AQUI: **a marca pode não estar no catálogo**. Quem tem
 * plataforma de metalúrgica da região ou carreta de fabricante local precisa
 * conseguir cadastrar. Então a marca é resolvida contra `marcas` quando dá, e
 * cai para texto livre quando não dá — nunca recusa o cadastro. Ver o comentário
 * longo em `models/perfil-maquina.js`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Casa os nomes de marca digitados com o catálogo, em UMA consulta para a lista
 * inteira. A comparação é por `nome_normalizado` e por `slug`: "john deere",
 * "John Deere" e "john-deere" são a mesma marca para qualquer pessoa, e
 * precisam ser a mesma para o banco.
 */
async function indiceDeMarcas(entradas) {
  const chaves = [...new Set(entradas.map((item) => normalizar(item.marca || '')).filter(Boolean))];
  const ids = [...new Set(entradas.map((item) => item.marcaId).filter(Boolean))];

  if (!chaves.length && !ids.length) return new Map();

  const marcas = await db.Marca.findAll({
    where: db.Sequelize.or(
      ...(chaves.length ? [{ nome_normalizado: chaves }, { slug: chaves }] : []),
      ...(ids.length ? [{ id: ids }] : [])
    ),
    attributes: ['id', 'nome', 'slug', 'nome_normalizado'],
  });

  const indice = new Map();
  marcas.forEach((marca) => {
    indice.set(String(marca.id), marca);
    indice.set(marca.slug, marca);
    indice.set(marca.nome_normalizado, marca);
  });

  return indice;
}

/** uma linha da frota, já pronta para o banco */
function montar(perfilId, item, indice) {
  const doCatalogo =
    (item.marcaId && indice.get(String(item.marcaId))) || indice.get(normalizar(item.marca || ''));

  /* o nome do catálogo tem precedência sobre o digitado: se a pessoa escreveu
     "jhon deere" e casou por id, a frota mostra a grafia certa */
  const marcaNome = (doCatalogo ? doCatalogo.nome : item.marca || '').trim();

  if (!marcaNome) throw erros.validacao({ maquinas: 'Informe a marca da máquina.' });
  if (!item.modelo || !String(item.modelo).trim()) {
    throw erros.validacao({ maquinas: 'Informe o modelo da máquina.' });
  }

  const modelo = String(item.modelo).trim();

  return {
    perfil_id: perfilId,
    marca_id: doCatalogo ? doCatalogo.id : null,
    marca_nome: marcaNome.slice(0, 100),
    modelo: modelo.slice(0, 120),
    modelo_normalizado: normalizar(modelo).slice(0, 120),
    tipo: item.tipo || 'trator',
    ano: item.ano ?? null,
    identificacao: item.identificacao || null,
    observacao: item.observacao || null,
    maquina_id: item.maquinaId || null,
  };
}

/**
 * Substitui a frota inteira pelo que veio.
 *
 * Aqui é substituição e não diferença conservadora (como em culturas): a tela
 * edita a lista como bloco — adiciona, remove e o botão "Desfazer" recoloca —,
 * e a linha da frota não tem nada que valha preservar além do que o próprio
 * formulário reenvia. Manter id estável exigiria que o front devolvesse ids que
 * ele gera localmente (`m${Date.now()}`), o que seria um contrato falso.
 *
 * O item que já traz `id` de verdade (UUID vindo da API) é preservado — assim
 * quem recarrega a tela e salva sem mexer não vê a frota inteira renascer com
 * `criado_em` de hoje.
 */
async function sincronizar(perfil, entradas, { transacao } = {}) {
  const itens = entradas || [];

  if (itens.length > MAXIMO_MAQUINAS) {
    throw erros.validacao({ maquinas: `No máximo ${MAXIMO_MAQUINAS} máquinas.` });
  }

  const indice = await indiceDeMarcas(itens);
  const linhas = itens.map((item) => montar(perfil.id, item, indice));

  const manter = itens
    .map((item) => item.id)
    .filter((id) => id && UUID.test(String(id)))
    .map(String);

  const atuais = await db.PerfilMaquina.findAll({
    where: { perfil_id: perfil.id },
    attributes: ['id'],
    transaction: transacao,
  });

  const aRemover = atuais.map((linha) => String(linha.id)).filter((id) => !manter.includes(id));

  if (aRemover.length) {
    await db.PerfilMaquina.destroy({ where: { id: aRemover }, transaction: transacao });
  }

  /* atualiza o que ficou e insere o que é novo. O laço de `update` é limitado
     pelo teto de MAXIMO_MAQUINAS e cada linha tem valores diferentes — não há
     bulk que expresse isso; o insert, esse sim, vai em lote */
  const novos = [];

  for (let i = 0; i < itens.length; i += 1) {
    const id = itens[i].id && UUID.test(String(itens[i].id)) ? String(itens[i].id) : null;

    if (id && atuais.some((linha) => String(linha.id) === id)) {
      await db.PerfilMaquina.update(linhas[i], { where: { id }, transaction: transacao });
    } else {
      novos.push(linhas[i]);
    }
  }

  if (novos.length) await db.PerfilMaquina.bulkCreate(novos, { transaction: transacao });

  return { total: itens.length, removidas: aRemover.length };
}

/** a frota do perfil, na ordem em que foi cadastrada */
const listar = (perfilId) =>
  db.PerfilMaquina.findAll({
    where: { perfil_id: perfilId },
    order: [['criado_em', 'ASC']],
  });

module.exports = { sincronizar, listar };
