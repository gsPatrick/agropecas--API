'use strict';

/**
 * Linha do banco → JSON da API.
 *
 * A busca é rota PÚBLICA e sem login: é a superfície mais exposta do sistema.
 * Por isso a lista branca aqui é mais rígida que a das demais features — nada
 * entra na resposta por acidente de `SELECT`.
 *
 * Três regras de privacidade estão implementadas neste arquivo, e não no SQL,
 * porque são decisão de exposição e não de consulta:
 *
 *  1. `exibir_whatsapp` — o número só sai se o titular consentiu. É
 *     consentimento LGPD registrado em `consentimentos`, não preferência de UI.
 *  2. `exibir_endereco_exato` — o padrão do produtor é falso: ele anuncia de
 *     casa, e devolver a coordenada exata da propriedade num JSON público é
 *     entregar o endereço de quem tem maquinário no pátio. Quando é falso, sai
 *     a sede do município.
 *  3. `documento`, `email`, `usuario_id` — nunca aparecem, nem por engano:
 *     não estão no SELECT e não estão aqui.
 */

/** dinheiro sai em centavos (inteiro) e formatado; o front não recalcula */
const preco = (linha) => {
  if (linha.preco_a_combinar) return { aCombinar: true, centavos: null, reais: null };
  const centavos = linha.preco_centavos === null ? null : Number(linha.preco_centavos);
  return { aCombinar: false, centavos, reais: centavos === null ? null : centavos / 100 };
};

/**
 * Localização respeitando o consentimento do anunciante.
 *
 * `aproximada: true` não é detalhe cosmético — é o que permite o front desenhar
 * o círculo em vez do alfinete. Sem esse sinal, a tela mostraria um pino
 * preciso sobre uma coordenada de cidade e o usuário iria até a praça central
 * procurar uma peça que está a 40 km dali.
 */
function localizacao(linha) {
  const exato = linha.exibir_endereco_exato === true && linha.latitude !== null;

  const latitude = exato ? linha.latitude : linha.municipio_latitude;
  const longitude = exato ? linha.longitude : linha.municipio_longitude;

  return {
    cidade: linha.municipio_nome || null,
    uf: linha.municipio_uf || linha.uf || null,
    latitude: latitude === null || latitude === undefined ? null : Number(latitude),
    longitude: longitude === null || longitude === undefined ? null : Number(longitude),
    aproximada: !exato,
    distanciaKm:
      linha.distancia_km === null || linha.distancia_km === undefined
        ? null
        : Math.round(Number(linha.distancia_km) * 10) / 10,
  };
}

const anunciante = (linha) => ({
  id: linha.perfil_id,
  slug: linha.perfil_slug,
  nome: linha.perfil_nome,
  tipo: linha.perfil_tipo,
  fotoUrl: linha.perfil_foto,
  verificado: Boolean(linha.perfil_verificado_em),
  /* o número só existe na resposta com consentimento — e a chave some por
     inteiro em vez de vir `null`, para não induzir o front a montar um link
     wa.me vazio */
  ...(linha.exibir_whatsapp && linha.perfil_whatsapp
    ? { whatsapp: linha.perfil_whatsapp }
    : {}),
  exibirWhatsapp: Boolean(linha.exibir_whatsapp),
});

const resultado = (linha) => ({
  id: linha.id,
  codigo: linha.codigo,
  slug: linha.slug,
  titulo: linha.titulo,
  tipo: linha.tipo,
  condicao: linha.condicao,
  negociacao: linha.negociacao,

  preco: preco(linha),
  aceitaTroca: linha.aceita_troca,
  aceitaEntrega: linha.aceita_entrega,
  quantidade: linha.quantidade,
  unidade: linha.unidade,
  codigoPeca: linha.codigo_peca,

  categoria: linha.categoria_slug
    ? { slug: linha.categoria_slug, nome: linha.categoria_nome, icone: linha.categoria_icone }
    : null,
  marca: linha.marca_slug ? { slug: linha.marca_slug, nome: linha.marca_nome } : null,

  local: localizacao(linha),
  anunciante: anunciante(linha),

  foto: linha.foto_url
    ? { url: linha.foto_url, thumb: linha.foto_thumb, alt: linha.foto_alt || linha.titulo }
    : null,

  destaque: Boolean(linha.destaque_ate && new Date(linha.destaque_ate) > new Date()),
  publicadoEm: linha.publicado_em,
  totalVisualizacoes: linha.total_visualizacoes,
  totalFavoritos: linha.total_favoritos,

  /* a nota de relevância volta para o front poder depurar ordenação em
     homologação; é número derivado, não expõe nada do anunciante */
  relevancia: linha.relevancia === null || linha.relevancia === undefined
    ? null
    : Math.round(Number(linha.relevancia) * 1000) / 1000,
});

const faceta = (linha) => ({
  valor: linha.valor,
  rotulo: linha.rotulo || linha.valor,
  total: Number(linha.total),
});

const sugestao = (linha) => ({
  tipo: linha.fonte,
  rotulo: linha.rotulo,
  valor: linha.valor,
  alvo: linha.alvo || null,
});

const termoPopular = (linha) => ({
  termo: linha.termo_exibicao,
  termoNormalizado: linha.termo_normalizado,
  total: Number(linha.total_buscas),
  semResultado: Number(linha.total_sem_resultado || 0),
  uf: linha.uf || null,
});

module.exports = { resultado, faceta, sugestao, termoPopular, preco, localizacao, anunciante };
