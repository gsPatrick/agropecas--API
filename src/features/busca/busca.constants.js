'use strict';

/**
 * Constantes da busca.
 *
 * Ficam fora dos services porque quase todas são números que serão
 * questionados numa revisão de performance (TTL, teto de página, raio máximo)
 * — e um número desses espalhado em três arquivos é um número que muda em dois.
 */

/** ordenações aceitas — vocabulário fechado, o front tem exatamente estes */
const ORDEM = {
  RELEVANCIA: 'relevancia',
  RECENTES: 'recentes',
  MENOR_PRECO: 'menorPreco',
  MAIOR_PRECO: 'maiorPreco',
  PROXIMOS: 'proximos',
};

const ORDENS = Object.values(ORDEM);

/**
 * Opções do seletor do front. O teto real é `POR_PAGINA_MAXIMO`: o seletor é
 * UI e pode mudar, o teto é defesa — `?pp=999999` numa tabela de anúncios com
 * LATERAL de foto é um jeito trivial de derrubar o banco sem má-fé nenhuma.
 */
const POR_PAGINA_OPCOES = [10, 20, 30, 35];
const POR_PAGINA_PADRAO = 20;
const POR_PAGINA_MAXIMO = 35;

/**
 * TTLs curtos de propósito.
 *
 * A busca é a rota mais chamada e a mais raspável; cachear por 45s corta a
 * rajada (o usuário que pagina, o robô que repete, os 20 acessos ao mesmo link
 * compartilhado no zap) sem que um anúncio recém-publicado demore a aparecer.
 * Acima de um minuto o anunciante liga reclamando que "não apareceu".
 */
const TTL_RESULTADO = 45;
const TTL_FACETAS = 60;
const TTL_SUGESTAO = 300;
const TTL_TERMOS_POPULARES = 600;
const TTL_MUNICIPIO = 3600;

/** termo menor que isto não busca: 1 caractere casa com metade do catálogo */
const TERMO_MINIMO = 2;
const TERMO_MAXIMO = 120;

/** limites da busca por proximidade */
const RAIO_PADRAO_KM = 100;
const RAIO_MAXIMO_KM = 600;

/** quantos itens o autocomplete devolve por fonte e no total */
const SUGESTOES_POR_FONTE = 6;
const SUGESTOES_TOTAL = 10;

/** quantas categorias a faceta devolve — a árvore inteira não cabe na tela */
const FACETAS_LIMITE = 24;

/** de onde a busca partiu, para o relatório de termos (coluna `origem`) */
const ORIGEM = ['hero', 'listagem', 'header', 'atalho', 'api'];

/** raio da Terra em km — Haversine */
const RAIO_TERRA_KM = 6371;

/**
 * Nomes dos trabalhos de fila.
 *
 * Ficam aqui, e não no arquivo do trabalho, para quebrar o ciclo de require:
 * o service enfileira pelo nome, o arquivo do trabalho importa o service para
 * executá-lo. Se o nome morasse lá, um exigiria o outro nos dois sentidos.
 */
const TRABALHO_LOG = 'busca.registrarLog';
const TRABALHO_TERMOS = 'busca.agregarTermosPopulares';

/** por quantos dias o log cru de busca é mantido — LGPD, minimização */
const RETENCAO_LOG_DIAS = 180;

module.exports = {
  ORDEM,
  ORDENS,
  POR_PAGINA_OPCOES,
  POR_PAGINA_PADRAO,
  POR_PAGINA_MAXIMO,
  TTL_RESULTADO,
  TTL_FACETAS,
  TTL_SUGESTAO,
  TTL_TERMOS_POPULARES,
  TTL_MUNICIPIO,
  TERMO_MINIMO,
  TERMO_MAXIMO,
  RAIO_PADRAO_KM,
  RAIO_MAXIMO_KM,
  SUGESTOES_POR_FONTE,
  SUGESTOES_TOTAL,
  FACETAS_LIMITE,
  ORIGEM,
  RAIO_TERRA_KM,
  TRABALHO_LOG,
  TRABALHO_TERMOS,
  RETENCAO_LOG_DIAS,
};
