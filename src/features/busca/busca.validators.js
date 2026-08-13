'use strict';

const { campos, esquema } = require('../../validacao');
const { ANUNCIO_TIPO, ANUNCIO_CONDICAO, ANUNCIO_NEGOCIACAO } = require('../../models/constantes');
const {
  ORDENS,
  TERMO_MAXIMO,
  POR_PAGINA_MAXIMO,
  RAIO_MAXIMO_KM,
  ORIGEM,
} = require('./busca.constants');

/**
 * Esquemas da busca.
 *
 * Os nomes curtos (`q`, `cat`, `cond`, `min`, `max`, `p`, `pp`) não são
 * economia de digitação: são os parâmetros que o front JÁ coloca na URL, e a
 * URL da busca é compartilhada por WhatsApp. Renomear para `termo` e
 * `categoria` quebraria todo link já enviado. Os nomes longos existem como
 * apelido para quem consome a API direto.
 *
 * O middleware `validar.query` SUBSTITUI `req.query` pelo resultado — o que
 * não está declarado aqui não chega ao service. É a primeira barreira contra
 * injeção: um `q` de 5.000 caracteres com SQL dentro é recusado por tamanho
 * antes de qualquer coisa, e o que passa vai para bind parameter.
 */

/* aceita "1"/"true"/"" vindos da query string — booleano de URL nunca é
   booleano de verdade */
const booleanoDeQuery = () => campos.booleano();

const paginacao = {
  p: campos.inteiro().min(1).max(10000),
  pagina: campos.inteiro().min(1).max(10000),
  /* o teto também é aplicado no service (`lerPaginacao`); aqui ele existe para
     que `pp=999999` volte 422 explicando, em vez de silenciosamente virar 35 */
  pp: campos.inteiro().min(1).max(POR_PAGINA_MAXIMO, `No máximo ${POR_PAGINA_MAXIMO} por página.`),
  porPagina: campos.inteiro().min(1).max(POR_PAGINA_MAXIMO, `No máximo ${POR_PAGINA_MAXIMO} por página.`),
};

const localizacao = {
  uf: campos.texto().min(2).max(2).rotulo('UF'),
  cidade: campos.texto().max(120),
  municipioId: campos.uuid(),
  cep: campos.cep(),
  lat: campos.numero().min(-90).max(90),
  lon: campos.numero().min(-180).max(180),
  raioKm: campos.inteiro().min(1).max(RAIO_MAXIMO_KM),
};

const buscar = esquema({
  q: campos.texto().max(TERMO_MAXIMO, 'Busca longa demais.'),
  termo: campos.texto().max(TERMO_MAXIMO),

  cat: campos.texto().max(200),
  categoria: campos.texto().max(200),
  marca: campos.texto().max(200),
  maquina: campos.texto().max(200),

  tipo: campos.umDe(ANUNCIO_TIPO).rotulo('tipo'),
  cond: campos.umDe(ANUNCIO_CONDICAO).rotulo('condição'),
  condicao: campos.umDe(ANUNCIO_CONDICAO).rotulo('condição'),
  negociacao: campos.umDe(ANUNCIO_NEGOCIACAO),

  /* em REAIS, como o slider do front manda. A conversão para centavos é do
     service — deixar o cliente mandar centavos convidaria a erro de 100x */
  min: campos.numero().min(0).max(100000000),
  max: campos.numero().min(0).max(100000000),
  aCombinar: booleanoDeQuery(),

  dias: campos.inteiro().min(1).max(365),
  aceitaEntrega: booleanoDeQuery(),
  aceitaTroca: booleanoDeQuery(),

  ord: campos.umDe(ORDENS).rotulo('ordenação'),
  ordem: campos.umDe(ORDENS).rotulo('ordenação'),

  facetas: booleanoDeQuery(),
  origem: campos.umDe(ORIGEM),

  ...localizacao,
  ...paginacao,
});

const sugerir = esquema({
  q: campos.texto().max(TERMO_MAXIMO).obrigatorio('Informe o que procura.'),
  uf: campos.texto().min(2).max(2),
  limite: campos.inteiro().min(1).max(20),
});

const termosPopulares = esquema({
  uf: campos.texto().min(2).max(2),
  limite: campos.inteiro().min(1).max(30),
  dias: campos.inteiro().min(1).max(30),
});

const registrarClique = esquema({
  anuncioId: campos.uuid().obrigatorio('Informe o anúncio.'),
  termo: campos.texto().max(TERMO_MAXIMO),
});

module.exports = { buscar, sugerir, termosPopulares, registrarClique };
