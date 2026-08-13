'use strict';

/**
 * Model → JSON da API, por lista branca.
 *
 * Três decisões de privacidade estão implementadas AQUI e não no controller,
 * porque o mapper é o único ponto pelo qual todo anúncio passa antes de virar
 * resposta — regra de exposição espalhada por rota é regra que um dia falta em
 * uma delas:
 *
 *  1. **WhatsApp só sai com `exibir_whatsapp`.** É consentimento LGPD colhido
 *     no cadastro, não preferência de interface (Maturacao/05, §8.1).
 *  2. **Coordenada exata só sai com `exibir_endereco_exato`.** Produtor rural
 *     anuncia de dentro da propriedade; publicar o pino exato de quem não pediu
 *     isso expõe onde a pessoa dorme (Maturacao/05, §9.3).
 *  3. **`observacoes_internas`, `moderacao_motivo` e `moderado_por` nunca vão
 *     para rota pública** — é conversa da moderação, não conteúdo do anúncio.
 */

const reais = (centavos) => (centavos === null || centavos === undefined ? null : Number(centavos));

const foto = (registro) => {
  if (!registro) return null;
  return {
    id: registro.id,
    url: registro.url,
    urlThumb: registro.url_thumb,
    largura: registro.largura,
    altura: registro.altura,
    ordem: registro.ordem,
    principal: registro.principal,
    textoAlternativo: registro.texto_alternativo,
  };
};

/** fotos bloqueadas pela moderação somem da resposta sem apagar o anúncio */
const fotosVisiveis = (lista = []) =>
  (lista || [])
    .filter((item) => !item.bloqueada)
    .sort((a, b) => a.ordem - b.ordem || (b.principal ? 1 : 0) - (a.principal ? 1 : 0))
    .map(foto);

const capa = (lista = []) => {
  const visiveis = fotosVisiveis(lista);
  return visiveis.find((item) => item.principal) || visiveis[0] || null;
};

const categoria = (registro) =>
  registro ? { id: registro.id, nome: registro.nome, slug: registro.slug, icone: registro.icone } : null;

const marca = (registro) => (registro ? { id: registro.id, nome: registro.nome, slug: registro.slug } : null);

const numeroOuNulo = (valor) => {
  if (valor === null || valor === undefined) return null;
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : null;
};

/**
 * Município do anúncio — agora COM a coordenada da sede.
 *
 * Por que a coordenada da sede sai mesmo sem `exibir_endereco_exato`: ela não
 * é o endereço de ninguém. É um ponto público do IBGE, o mesmo para os 4 mil
 * habitantes da cidade, e é exatamente o que o mapa do front precisa para
 * desenhar o pino "região de Sorriso" quando o anunciante não autorizou o
 * ponto exato. Antes disso o front carregava uma tabela de 8 sedes chumbada no
 * código — informação de referência duplicada em dois repositórios, que só
 * cobria 8 dos 141 municípios de MT e envelhecia sozinha.
 *
 * A coordenada EXATA do anúncio continua saindo apenas com consentimento, em
 * `localizacao.latitude/longitude` (ver `localizacao()` abaixo).
 */
const municipio = (registro) =>
  registro
    ? {
        id: registro.id,
        nome: registro.nome,
        uf: registro.uf,
        latitude: numeroOuNulo(registro.latitude),
        longitude: numeroOuNulo(registro.longitude),
      }
    : null;

/**
 * Bloco do anunciante que a página pública mostra.
 * Sem documento (CPF/CNPJ), sem e-mail de login e sem telefone que o dono não
 * autorizou — o chat interno continua disponível para quem recusou o WhatsApp.
 */
const anunciante = (perfil) => {
  if (!perfil) return null;

  const exibeWhatsapp = perfil.exibir_whatsapp === true;

  return {
    perfilId: perfil.id,
    slug: perfil.slug,
    nomeExibicao: perfil.nome_exibicao,
    tipo: perfil.tipo,
    fotoUrl: perfil.foto_url,
    verificado: Boolean(perfil.verificado_em),
    membroDesde: perfil.membro_desde,
    aceitaChat: perfil.aceita_chat !== false,
    exibirWhatsapp: exibeWhatsapp,
    whatsapp: exibeWhatsapp ? perfil.whatsapp : null,
    totalAnunciosAtivos: perfil.total_anuncios_ativos,
  };
};

/**
 * Localização conforme o consentimento do anunciante.
 * Sem endereço exato, sobra o suficiente para filtrar por município e para o
 * selo "Localização aproximada" do front — e nada que aponte a porteira.
 */
const localizacao = (registro, perfil) => {
  const exato = perfil?.exibir_endereco_exato === true && registro.precisao_localizacao === 'exata';
  const sede = municipio(registro.municipio);

  /**
   * `coordenada` é o pino que o mapa deve desenhar, com a origem declarada.
   *
   * Existe porque, sem ele, quem consome precisa deduzir: "latitude é null,
   * então tento o município, se o município tiver coordenada…". Essa dedução
   * foi feita no front e virou a tabela `SEDES` chumbada. Devolvendo o ponto
   * já escolhido E dizendo de onde ele veio, a tela só decide o texto do selo
   * ("Localização aproximada") — nunca de onde tirar o pino.
   *
   * `aproximada: true` é a bandeira que impede o front de tratar sede de
   * município como endereço do anunciante.
   */
  const coordenada = exato
    ? {
        latitude: numeroOuNulo(registro.latitude),
        longitude: numeroOuNulo(registro.longitude),
        origem: 'endereco',
        aproximada: false,
      }
    : sede && sede.latitude !== null && sede.longitude !== null
      ? {
          latitude: sede.latitude,
          longitude: sede.longitude,
          origem: 'municipio',
          aproximada: true,
        }
      : null;

  return {
    uf: registro.uf,
    municipio: sede,
    municipioId: registro.municipio_id,
    precisao: exato ? 'exata' : 'aproximada',
    /* estes dois seguem sendo o ENDEREÇO do anunciante: null sem consentimento.
       Preenchê-los com a sede do município tornaria impossível distinguir
       "aqui mora o anunciante" de "em algum lugar desta cidade" */
    latitude: exato ? Number(registro.latitude) || null : null,
    longitude: exato ? Number(registro.longitude) || null : null,
    coordenada,
    /* o endereço textual completo só acompanha a coordenada exata */
    enderecoId: exato ? registro.endereco_id : null,
  };
};

/** cartão da vitrine — o mínimo que a listagem desenha */
/**
 * Distância até a origem da busca, quando a listagem foi pedida por proximidade.
 *
 * O valor é calculado no SQL (coluna virtual `distancia_km`) e chega aqui já
 * pronto. A mesma regra de privacidade da feature `localizacao` se aplica:
 * anúncio sem endereço exato autorizado só divulga a distância em faixas de
 * 5 km — distância exata pedida de três origens diferentes recupera o ponto
 * por trilateração, e o disfarce da coordenada não teria servido de nada.
 */
const distancia = (registro) => {
  const bruta = registro.get ? registro.get('distancia_km') : registro.distancia_km;
  if (bruta === null || bruta === undefined) return null;

  const km = Number(bruta);
  if (!Number.isFinite(km)) return null;

  const exato =
    registro.perfil?.exibir_endereco_exato === true && registro.precisao_localizacao === 'exata';

  return exato ? Math.round(km * 10) / 10 : Math.max(5, Math.round(km / 5) * 5);
};

const resumo = (registro) => {
  if (!registro) return null;

  return {
    distanciaKm: distancia(registro),
    id: registro.id,
    codigo: registro.codigo,
    slug: registro.slug,
    tipo: registro.tipo,
    titulo: registro.titulo,
    condicao: registro.condicao,
    negociacao: registro.negociacao,
    precoCentavos: reais(registro.preco_centavos),
    precoACombinar: registro.preco_a_combinar,
    aceitaTroca: registro.aceita_troca,
    moeda: registro.moeda,
    status: registro.status,
    uf: registro.uf,
    municipio: municipio(registro.municipio),
    precisaoLocalizacao: registro.precisao_localizacao,
    categoria: categoria(registro.categoria),
    marca: marca(registro.marca),
    capa: capa(registro.fotos),
    anunciante: anunciante(registro.perfil),
    totalVisualizacoes: registro.total_visualizacoes,
    totalFavoritos: registro.total_favoritos,
    destaque: Boolean(registro.destaque_ate && new Date(registro.destaque_ate) > new Date()),
    publicadoEm: registro.publicado_em,
    expiraEm: registro.expira_em,
    criadoEm: registro.criado_em,
  };
};

/**
 * `resumo()` + os dois contadores de contato — só para `GET /anuncios/meus`.
 * A vitrine pública nunca chama esta função: quantos contatos um anúncio de
 * terceiro recebeu é informação do dono, não da busca.
 */
const resumoDono = (registro) => ({
  ...resumo(registro),
  totalContatosWhatsapp: registro.total_contatos_whatsapp,
  totalContatosChat: registro.total_contatos_chat,
});

const atributo = (registro) => ({
  chave: registro.chave,
  rotulo: registro.rotulo,
  valor: registro.valor,
  unidade: registro.unidade,
  ordem: registro.ordem,
  filtravel: registro.filtravel,
});

/**
 * Página do anúncio.
 * `dono` liga os campos de gestão (moderação, contadores brutos, prazo) — o
 * visitante não recebe nem a chave.
 */
const detalhe = (registro, { dono = false } = {}) => {
  if (!registro) return null;

  const publico = {
    ...resumo(registro),
    descricao: registro.descricao,
    quantidade: registro.quantidade,
    unidade: registro.unidade,
    codigoPeca: registro.codigo_peca,
    aceitaEntrega: registro.aceita_entrega,
    entregaObservacao: registro.entrega_observacao,
    atendeNoLocal: registro.atende_no_local,
    localizacao: localizacao(registro, registro.perfil),
    fotos: fotosVisiveis(registro.fotos),
    atributos: (registro.atributos || []).sort((a, b) => a.ordem - b.ordem).map(atributo),
    maquinasCompativeis: (registro.maquinasCompativeis || []).map((maquina) => ({
      id: maquina.id,
      modelo: maquina.modelo,
      slug: maquina.slug,
      categoria: maquina.categoria_maquina,
    })),
    seoTitulo: registro.seo_titulo,
    seoDescricao: registro.seo_descricao,
  };

  if (!dono) return publico;

  return {
    ...publico,
    moderacaoStatus: registro.moderacao_status,
    moderacaoMotivo: registro.moderacao_motivo,
    moderadoEm: registro.moderado_em,
    renovadoEm: registro.renovado_em,
    totalRenovacoes: registro.total_renovacoes,
    totalContatosWhatsapp: registro.total_contatos_whatsapp,
    totalContatosChat: registro.total_contatos_chat,
    totalDenuncias: registro.total_denuncias,
    criadoPorAdmin: registro.criado_por_admin,
  };
};

const historico = (registro) => ({
  id: registro.id,
  statusAnterior: registro.status_anterior,
  statusNovo: registro.status_novo,
  motivo: registro.motivo,
  alteracoes: registro.alteracoes,
  ator: registro.ator ? { id: registro.ator.id, nome: registro.ator.nome } : null,
  atorPapel: registro.ator_papel,
  criadoEm: registro.criado_em,
});

const metricaDiaria = (registro) => ({
  data: registro.data,
  visualizacoes: registro.visualizacoes,
  visualizacoesUnicas: registro.visualizacoes_unicas,
  cliquesWhatsapp: registro.cliques_whatsapp,
  conversasIniciadas: registro.conversas_iniciadas,
  favoritos: registro.favoritos,
  compartilhamentos: registro.compartilhamentos,
});

/**
 * Quem procurou o anunciante.
 * Sai só para quem tem `anuncio.ver_contatos` — e mesmo assim sem IP em claro,
 * que nem existe no banco: a tabela guarda hash.
 */
const contato = (registro) => ({
  id: registro.id,
  canal: registro.canal,
  origem: registro.origem,
  interessado: registro.interessado
    ? { id: registro.interessado.id, nome: registro.interessado.nome }
    : null,
  conversaId: registro.conversa_id,
  criadoEm: registro.criado_em,
});

module.exports = {
  resumo,
  resumoDono,
  detalhe,
  foto,
  fotosVisiveis,
  capa,
  historico,
  metricaDiaria,
  contato,
  anunciante,
};
