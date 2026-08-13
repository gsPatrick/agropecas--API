'use strict';

const cache = require('../../cache');
const { base } = require('../../cache/chaves');

/**
 * Chaves de cache do catálogo.
 *
 * Moram aqui, e não em `src/cache/chaves.js`, porque o padrão §7 manda a chave
 * nova nascer dentro da própria feature — dois módulos escritos em paralelo
 * não podem disputar o mesmo arquivo. As chaves genéricas que já existiam
 * (`cache.chaves.categorias()` etc.) continuam válidas, mas não davam conta de
 * variação por filtro, e uma listagem filtrada gravada na chave sem filtro é
 * como um cache serve a resposta errada para o usuário seguinte.
 *
 * Regra do módulo: **um prefixo por assunto**. É o que permite invalidar
 * "tudo de marca" sem derrubar o cache de categoria, que é o mais caro de
 * reconstruir (a árvore inteira).
 */

const prefixo = (assunto) => `${base()}:catalogo:${assunto}`;

const chaves = {
  arvore: (assinatura) => `${prefixo('categorias')}:arvore:${assinatura}`,
  categoria: (slug) => `${prefixo('categorias')}:item:${slug}`,

  marcas: (assinatura) => `${prefixo('marcas')}:lista:${assinatura}`,
  maquinas: (assinatura) => `${prefixo('maquinas')}:lista:${assinatura}`,
  servicos: (assinatura) => `${prefixo('servicos')}:lista:${assinatura}`,
  culturas: () => `${prefixo('culturas')}:lista`,

  dominio: (assunto) => `${prefixo(assunto)}*`,
};

/**
 * Invalida um assunto inteiro.
 *
 * Deliberadamente grosso: apagar só a chave exata que mudou exigiria saber
 * todas as assinaturas de filtro já gravadas, e a primeira combinação
 * esquecida vira um item fantasma que só some no TTL. Reconstruir a lista de
 * marcas é um SELECT em tabela pequena — barato o suficiente para preferir a
 * correção à economia.
 */
async function invalidar(...assuntos) {
  await Promise.all(assuntos.map((assunto) => cache.invalidar(chaves.dominio(assunto))));
}

/**
 * Categoria e serviço são invalidados juntos.
 *
 * `servicos.categoria_id` aponta para categoria, e a listagem de serviço
 * devolve o nome da categoria: mexer numa categoria deixaria a lista de
 * serviços mostrando o nome antigo até o TTL vencer.
 */
const invalidarCategorias = () => invalidar('categorias', 'servicos');
const invalidarMarcas = () => invalidar('marcas', 'maquinas');
const invalidarMaquinas = () => invalidar('maquinas');
const invalidarServicos = () => invalidar('servicos');

module.exports = {
  chaves,
  invalidar,
  invalidarCategorias,
  invalidarMarcas,
  invalidarMaquinas,
  invalidarServicos,
};
