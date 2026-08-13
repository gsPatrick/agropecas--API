'use strict';

const crypto = require('crypto');
const db = require('../../models');
const cache = require('../../cache');
const { erros } = require('../../utils/erros');
const { normalizar } = require('../../utils/texto');
const { chaves } = require('./anuncio.cache');

/**
 * Peças compartilhadas entre criação e edição: tradução de campo, gravação das
 * tabelas filhas e invalidação de cache.
 *
 * Ficam fora dos dois services porque são exatamente as mesmas nos dois
 * caminhos — e a diferença entre criar e editar um anúncio nunca deveria ser
 * "esqueci de normalizar o título só num deles".
 */

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0, 1: são lidos por telefone

/** código curto público (AGP-7F3K) — é o que o usuário cita no suporte */
async function gerarCodigo() {
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const sufixo = Array.from({ length: 4 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('');
    const codigo = `AGP-${sufixo}`;
    if (!(await db.Anuncio.findOne({ where: { codigo }, attributes: ['id'], paranoid: false }))) {
      return codigo;
    }
  }
  throw erros.interno('Não foi possível gerar o código do anúncio.');
}

/**
 * Preço OU "a combinar".
 * A constraint `ck_anuncios_preco_ou_combinar` já garante isso no banco — mas
 * violação de CHECK vira erro genérico, e o usuário precisa saber QUAL campo
 * preencher. A conferência aqui existe pela mensagem, não pela integridade.
 */
function conferirPreco({ precoCentavos, precoACombinar }) {
  if (precoACombinar === true) return;
  if (precoCentavos === null || precoCentavos === undefined) {
    throw erros.validacao({ precoCentavos: 'Informe o preço ou marque "a combinar".' });
  }
}

/** camelCase da API → colunas. Campo ausente no corpo não vira `null` na edição */
const MAPA = {
  tipo: 'tipo',
  titulo: 'titulo',
  descricao: 'descricao',
  categoriaId: 'categoria_id',
  marcaId: 'marca_id',
  condicao: 'condicao',
  negociacao: 'negociacao',
  precoCentavos: 'preco_centavos',
  precoACombinar: 'preco_a_combinar',
  aceitaTroca: 'aceita_troca',
  quantidade: 'quantidade',
  unidade: 'unidade',
  codigoPeca: 'codigo_peca',
  aceitaEntrega: 'aceita_entrega',
  entregaObservacao: 'entrega_observacao',
  atendeNoLocal: 'atende_no_local',
  enderecoId: 'endereco_id',
  municipioId: 'municipio_id',
  uf: 'uf',
  latitude: 'latitude',
  longitude: 'longitude',
  seoTitulo: 'seo_titulo',
  seoDescricao: 'seo_descricao',
};

function paraColunas(dados = {}) {
  const colunas = {};
  Object.entries(MAPA).forEach(([entrada, coluna]) => {
    if (dados[entrada] !== undefined) colunas[coluna] = dados[entrada];
  });

  if (dados.titulo !== undefined) colunas.titulo_normalizado = normalizar(dados.titulo).slice(0, 160);
  if (dados.codigoPeca !== undefined) {
    colunas.codigo_peca_normalizado = dados.codigoPeca ? normalizar(dados.codigoPeca) : null;
  }
  if (colunas.uf) colunas.uf = String(colunas.uf).toUpperCase();

  return colunas;
}

/** substitui a ficha técnica inteira — diff parcial de chave/valor não compensa */
async function gravarAtributos(anuncioId, atributos, transacao) {
  if (!atributos) return;
  await db.AnuncioAtributo.destroy({ where: { anuncio_id: anuncioId }, transaction: transacao });
  if (!atributos.length) return;

  await db.AnuncioAtributo.bulkCreate(
    atributos.map((item, indice) => ({
      anuncio_id: anuncioId,
      chave: item.chave,
      rotulo: item.rotulo || item.chave,
      valor: item.valor,
      valor_numerico: item.valorNumerico ?? null,
      unidade: item.unidade || null,
      ordem: indice,
      filtravel: item.filtravel === true,
    })),
    { transaction: transacao }
  );
}

async function gravarMaquinas(anuncioId, maquinas, transacao) {
  if (!maquinas) return;
  await db.AnuncioMaquina.destroy({ where: { anuncio_id: anuncioId }, transaction: transacao });
  if (!maquinas.length) return;

  await db.AnuncioMaquina.bulkCreate(
    [...new Set(maquinas)].map((maquinaId) => ({ anuncio_id: anuncioId, maquina_id: maquinaId })),
    { transaction: transacao }
  );
}

/**
 * Toda escrita derruba o detalhe e o domínio das listas.
 * TTL aqui é rede de segurança, não estratégia: vitrine que mostra anúncio
 * removido por mais um minuto é reclamação certa.
 */
async function invalidar(anuncioId) {
  await cache.remover(chaves.detalhe(anuncioId), chaves.parecidos(anuncioId));
  await cache.invalidar(chaves.dominioListas());
}

module.exports = {
  gerarCodigo,
  conferirPreco,
  paraColunas,
  gravarAtributos,
  gravarMaquinas,
  invalidar,
};
