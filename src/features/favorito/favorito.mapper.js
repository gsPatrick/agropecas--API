'use strict';

/**
 * Model → JSON da API.
 *
 * Lista branca explícita. O anúncio aqui é uma versão **de card**, não o
 * detalhe: quem abre "meus salvos" quer capa, título, preço e se ainda está no
 * ar. Devolver o objeto inteiro do anúncio nesta rota faria a tela de lista
 * carregar tanto quanto a de detalhe, e ninguém notaria até a lista crescer.
 *
 * Nada de contato do anunciante neste mapper — a lista de favoritos não é
 * lugar de expor WhatsApp de ninguém. Ver `features/contato`.
 */

const foto = (registro) => {
  if (!registro) return null;
  return { id: registro.id, url: registro.url, miniatura: registro.url_thumb || registro.url };
};

/** o card do anúncio dentro da lista de salvos */
const anuncioCard = (registro) => {
  if (!registro) return null;

  const fotos = registro.fotos || [];

  return {
    id: registro.id,
    codigo: registro.codigo,
    slug: registro.slug,
    titulo: registro.titulo,
    tipo: registro.tipo,
    status: registro.status,
    /* status vem junto de propósito: o item salvo pode ter sido pausado ou
       vendido, e a tela precisa mostrar isso em vez de levar a um anúncio
       morto */
    disponivel: registro.status === 'publicado',
    precoCentavos: registro.preco_centavos === null ? null : Number(registro.preco_centavos),
    precoACombinar: registro.preco_a_combinar,
    moeda: registro.moeda,
    condicao: registro.condicao,
    municipioId: registro.municipio_id,
    uf: registro.uf,
    totalFavoritos: registro.total_favoritos,
    publicadoEm: registro.publicado_em,
    capa: foto(fotos[0]),
  };
};

const item = (registro) => ({
  id: registro.id,
  anuncioId: registro.anuncio_id,
  anotacao: registro.anotacao,
  criadoEm: registro.criado_em,
  anuncio: anuncioCard(registro.anuncio),
});

const lista = (registros = []) => registros.map(item);

module.exports = { item, lista, anuncioCard };
