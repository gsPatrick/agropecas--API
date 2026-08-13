'use strict';

const { campos, esquema } = require('../../validacao');
const { MAXIMO_IDS_POR_LOTE, ANOTACAO_MAXIMA } = require('./favorito.constants');

/**
 * Esquemas de entrada da feature.
 *
 * Note o que NÃO existe aqui: `usuarioId`. Favorito é sempre do autor da
 * requisição e o dono sai de `contexto.usuarioId`. Aceitar o campo no corpo,
 * mesmo "só para o admin", cria o caminho para alguém encher a lista de outra
 * pessoa — e é o tipo de brecha que passa despercebida na revisão porque o
 * front nunca manda o campo.
 */

const anuncioObrigatorio = () => campos.uuid().obrigatorio('Informe o anúncio.');

const salvar = esquema({
  anuncioId: anuncioObrigatorio(),
  anotacao: campos.texto().max(ANOTACAO_MAXIMA),
});

const identificadorAnuncio = esquema({ anuncioId: anuncioObrigatorio() });

const identificadorUsuario = esquema({
  usuarioId: campos.uuid().obrigatorio('Identificador inválido.'),
});

/**
 * Checagem em lote de "está favoritado?".
 *
 * O teto de itens não é burocracia: é o que impede transformar a rota num
 * `IN (...)` de dez mil UUIDs — que o Postgres aceita e demora, e que nenhuma
 * tela legítima produz, porque a listagem tem paginação com teto de 100.
 */
const marcados = esquema({
  anuncioIds: campos
    .lista(campos.uuid())
    .obrigatorio('Informe os anúncios a conferir.')
    .min(1, 'Informe ao menos um anúncio.')
    .max(MAXIMO_IDS_POR_LOTE, `No máximo ${MAXIMO_IDS_POR_LOTE} anúncios por consulta.`),
});

const listar = esquema({
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
  /* o usuário salva peça e serviço na mesma lista; filtrar por tipo é o
     recorte que a tela de "meus salvos" oferece */
  tipo: campos.texto().max(20),
  status: campos.texto().max(20),
});

module.exports = { salvar, identificadorAnuncio, identificadorUsuario, marcados, listar };
