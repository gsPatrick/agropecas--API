'use strict';

/**
 * Constantes da feature. Ficam fora dos services para que trocar um TTL não
 * exija caçar o número em três arquivos.
 */

const DIA = 24 * 60 * 60;

/**
 * TTLs.
 *
 * CEP e geocodificação são dados de terceiro que praticamente não mudam —
 * logradouro novo aparece uma vez por ano, município nunca muda de lugar. TTL
 * de dias aqui não é agressividade: é reconhecer que a alternativa é bater numa
 * API pública e gratuita a cada tecla do formulário de cadastro.
 *
 * Estado e município são NOSSA tabela e só mudam por seeder — cache de um dia
 * com invalidação manual é folgado.
 */
const TTL = {
  cep: 30 * DIA,
  cepInexistente: 1 * DIA, // "não existe" também vale cachear, mas por menos tempo
  geocodificacao: 30 * DIA,
  estados: 7 * DIA,
  municipios: 1 * DIA,
};

/**
 * Raio da ofuscação de coordenada, em metros.
 *
 * 3 km: maior que a maioria das sedes rurais de MT e menor que a distância
 * típica entre propriedades vizinhas. O pino cai "na região", que é o que o
 * comprador precisa para decidir se vale a viagem, sem apontar a porteira.
 */
const RAIO_OFUSCACAO_METROS = 3000;

/** teto do raio aceito em busca por proximidade — sem teto, `?raio=99999` varre a tabela */
const RAIO_BUSCA_MAX_KM = 1000;
const RAIO_BUSCA_PADRAO_KM = 100;

/** quantos alvos uma consulta de distância aceita de uma vez */
const MAX_ALVOS_DISTANCIA = 50;

/**
 * Perfis que nascem com endereço exato.
 *
 * Loja e prestador são ponto comercial: esconder o endereço deles atrapalharia
 * o próprio anunciante. Produtor nasce aproximado (Maturacao/05 §9.3) — o
 * padrão do model `Perfil.exibir_endereco_exato` já é `false`; esta lista é o
 * que o cadastro usa para sugerir o contrário a quem é comércio.
 */
const TIPOS_COM_ENDERECO_EXATO_PADRAO = ['loja', 'prestador'];

/** alvos aos quais um endereço pode ser vinculado */
const ALVO = { PERFIL: 'perfil', ANUNCIO: 'anuncio' };

/** ação RBAC exigida para escrever o endereço de cada alvo */
const ACAO_POR_ALVO = {
  [ALVO.PERFIL]: { editar: 'perfil.editar', ler: 'perfil.ler' },
  [ALVO.ANUNCIO]: { editar: 'anuncio.editar', ler: 'anuncio.ler' },
};

module.exports = {
  DIA,
  TTL,
  RAIO_OFUSCACAO_METROS,
  RAIO_BUSCA_MAX_KM,
  RAIO_BUSCA_PADRAO_KM,
  MAX_ALVOS_DISTANCIA,
  TIPOS_COM_ENDERECO_EXATO_PADRAO,
  ALVO,
  ACAO_POR_ALVO,
};
