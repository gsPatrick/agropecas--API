'use strict';

/**
 * Model → JSON. Lista branca explícita: campo novo no banco não aparece na API
 * sem alguém decidir que ele deve aparecer.
 *
 * Três decisões da cliente estão CODIFICADAS aqui, e não em `if` espalhado
 * pelos controllers — porque um mapper esquecido é como um dado vaza:
 *
 * 1. **Só WhatsApp como contato** (Maturacao/05 §8.2.1). O perfil não expõe
 *    telefone secundário, e-mail público nem `aceitaChat`: conversa nasce de
 *    anúncio, não de perfil. Quem quer falar, chama no WhatsApp ou entra num
 *    anúncio.
 * 2. **`exibir_whatsapp` é consentimento LGPD**, não preferência de UI. Falso
 *    significa que o número NÃO sai da API — para ninguém, nem quando este
 *    mapper é chamado de dentro do include de outra feature.
 * 3. **`documento` (CPF/CNPJ) nunca sai em rota pública.** Só o dono e quem
 *    tem escopo `.todos` recebem, e nesse segundo caso o service grava em
 *    `logs_acesso_dado` antes de chamar `privado()`.
 *
 * O perfil também não traz endereço nem mapa: localização é atributo do
 * anúncio (§8.2.1). O máximo que aparece é município/UF.
 */

/** contato único do perfil — a regra de ouro em uma função */
const whatsappVisivel = (registro) =>
  registro.exibir_whatsapp ? registro.whatsapp || null : null;

const municipio = (registro) =>
  registro
    ? { id: registro.id, nome: registro.nome, uf: registro.uf }
    : null;

const horario = (registro) => ({
  id: registro.id,
  diaSemana: registro.dia_semana,
  fechado: registro.fechado,
  abreAs: registro.abre_as,
  fechaAs: registro.fecha_as,
  intervaloInicio: registro.intervalo_inicio,
  intervaloFim: registro.intervalo_fim,
});

/** o item de catálogo vem com os campos da tabela de ligação em `.PerfilX` */
const servico = (registro) => ({
  id: registro.id,
  nome: registro.nome,
  slug: registro.slug,
  icone: registro.icone,
  precoReferenciaCentavos: registro.PerfilServico?.preco_referencia_centavos ?? null,
  observacao: registro.PerfilServico?.observacao ?? null,
  principal: Boolean(registro.PerfilServico?.principal),
});

const marca = (registro) => ({
  id: registro.id,
  nome: registro.nome,
  slug: registro.slug,
  logoUrl: registro.logo_url,
  autorizada: Boolean(registro.PerfilMarca?.autorizada),
});

/**
 * Cultura do produtor. Sai na visão PÚBLICA de propósito: "quem planta soja
 * aqui perto" é a pergunta que a loja de peças faz, e esconder a resposta
 * tiraria o motivo de o produtor preencher.
 */
const cultura = (registro) => ({
  id: registro.id,
  nome: registro.nome,
  slug: registro.slug,
  grupo: registro.grupo,
  principal: Boolean(registro.PerfilCultura?.principal),
});

/**
 * Máquina da frota.
 *
 * `marcaId` nulo NÃO é erro: é a marca que não está no catálogo (fabricante
 * pequeno), e `marcaNome` sempre tem o texto. O front não precisa saber a
 * diferença para renderizar — só para oferecer o filtro por marca quando há id.
 */
const maquina = (registro) => {
  const dado = registro.get ? registro.get({ plain: true }) : registro;

  return {
    id: dado.id,
    tipo: dado.tipo,
    marcaId: dado.marca_id,
    marca: dado.marca_nome,
    modelo: dado.modelo,
    ano: dado.ano,
    identificacao: dado.identificacao,
    observacao: dado.observacao,
  };
};

/**
 * Endereço do perfil.
 *
 * O logradouro completo é dado de localização do titular: só sai quando ele
 * consentiu em exibir endereço exato (`exibir_endereco_exato`). Sem
 * consentimento vai o que já era público de qualquer forma — bairro, município
 * e UF —, no mesmo critério que `localizacao.privacidade` aplica ao anúncio.
 */
const endereco = (registro, { completo = false } = {}) => {
  if (!registro) return null;

  const publico = {
    id: registro.id,
    bairro: registro.bairro,
    municipioNome: registro.municipio_nome,
    uf: registro.uf,
  };

  if (!completo) return publico;

  return {
    ...publico,
    cep: registro.cep,
    logradouro: registro.logradouro,
    numero: registro.numero,
    complemento: registro.complemento,
    referencia: registro.referencia,
  };
};

const areaAtendimento = (registro) => ({
  id: registro.id,
  nome: registro.nome,
  uf: registro.uf,
  taxaDeslocamentoCentavos: registro.PerfilAreaAtendimento?.taxa_deslocamento_centavos ?? null,
  observacao: registro.PerfilAreaAtendimento?.observacao ?? null,
});

/** os campos que existem só no tipo — nunca devolver os de outro tipo */
function especificos(registro) {
  if (registro.tipo === 'produtor') {
    return {
      propriedadeNome: registro.propriedade_nome,
      /* DECIMAL volta como string no pg; number é o que o front espera */
      areaHectares: registro.area_hectares === null ? null : Number(registro.area_hectares),
    };
  }

  if (registro.tipo === 'loja') {
    return {
      razaoSocial: registro.razao_social,
      nomeFantasia: registro.nome_fantasia,
      entregaObservacao: registro.entrega_observacao,
      formasEntrega: registro.formas_entrega || [],
      raioEntregaKm: registro.raio_entrega_km,
      prazoRespostaHoras: registro.prazo_resposta_horas,
    };
  }

  return {
    atendeNoCampo: registro.atende_no_campo,
    raioAtendimentoKm: registro.raio_atendimento_km,
    formasAtendimento: registro.formas_atendimento || [],
  };
}

/** as coleções só entram quando vieram no `include` — sem include, sem chave */
function colecoes(registro) {
  const saida = {};
  if (registro.horarios) saida.horarios = registro.horarios.map(horario);
  if (registro.servicos) saida.servicos = registro.servicos.map(servico);
  if (registro.marcas) saida.marcas = registro.marcas.map(marca);
  if (registro.culturas) saida.culturas = registro.culturas.map(cultura);
  if (registro.maquinas) saida.maquinas = registro.maquinas.map(maquina);
  if (registro.areaAtendimento) saida.areaAtendimento = registro.areaAtendimento.map(areaAtendimento);

  /* endereço público: só o que não depende de consentimento. A visão completa
     é montada em `privado()`, que sabe quem está pedindo */
  if (registro.endereco) saida.endereco = endereco(registro.endereco);

  return saida;
}

/**
 * Perfil público — o que o visitante sem login recebe em `GET /perfis/:slug`.
 * É o objeto que vai para o cache, então ele não pode depender de quem pediu.
 */
const publico = (registro) => {
  if (!registro) return null;

  return {
    id: registro.id,
    tipo: registro.tipo,
    slug: registro.slug,
    nomeExibicao: registro.nome_exibicao,
    bio: registro.bio,
    fotoUrl: registro.foto_url,
    capaUrl: registro.capa_url,
    site: registro.site,
    instagram: registro.instagram,
    facebook: registro.facebook,

    whatsapp: whatsappVisivel(registro),

    municipio: municipio(registro.municipio),
    uf: registro.uf,

    verificado: Boolean(registro.verificado_em),
    verificadoEm: registro.verificado_em,

    totalAnuncios: registro.total_anuncios,
    totalAnunciosAtivos: registro.total_anuncios_ativos,
    membroDesde: registro.membro_desde,

    ...especificos(registro),
    ...colecoes(registro),
  };
};

/** item da listagem — enxuto de propósito: card não precisa de bio nem coleção */
const item = (registro) => {
  if (!registro) return null;

  return {
    id: registro.id,
    tipo: registro.tipo,
    slug: registro.slug,
    nomeExibicao: registro.nome_exibicao,
    fotoUrl: registro.foto_url,
    whatsapp: whatsappVisivel(registro),
    municipio: municipio(registro.municipio),
    uf: registro.uf,
    verificado: Boolean(registro.verificado_em),
    totalAnunciosAtivos: registro.total_anuncios_ativos,
  };
};

/**
 * Perfil completo — para o dono e para quem tem escopo `.todos`.
 *
 * `documento` só entra com `comDocumento: true`, que o service liga depois de
 * decidir quem está pedindo (e, no caso de terceiro, depois de registrar o
 * acesso em `logs_acesso_dado`).
 */
const privado = (registro, { comDocumento = false } = {}) => {
  if (!registro) return null;

  return {
    ...publico(registro),

    /* aqui o número sai mesmo com `exibir_whatsapp = false`: o dono precisa
       ver o que cadastrou para poder corrigir. O que o consentimento controla
       é a PUBLICAÇÃO do dado, não o acesso do próprio titular a ele */
    whatsapp: registro.whatsapp || null,
    exibirWhatsapp: registro.exibir_whatsapp,
    exibirEnderecoExato: registro.exibir_endereco_exato,
    aceitaChat: registro.aceita_chat,

    telefoneSecundario: registro.telefone_secundario,
    emailPublico: registro.email_publico,
    inscricaoEstadual: registro.tipo === 'loja' ? registro.inscricao_estadual : undefined,

    pessoaTipo: registro.pessoa_tipo,
    documentoTipo: registro.documento_tipo,
    ...(comDocumento ? { documento: registro.documento } : {}),

    municipioId: registro.municipio_id,
    enderecoId: registro.endereco_id,

    /* o titular (e quem tem escopo `.todos`) vê o endereço inteiro: é o próprio
       dado dele, e sem isto a tela de edição não conseguiria mostrar o que
       está gravado para poder corrigir — mesmo raciocínio do WhatsApp acima */
    ...(registro.endereco ? { endereco: endereco(registro.endereco, { completo: true }) } : {}),

    verificacaoObservacao: registro.verificacao_observacao,
    verificadoPor: registro.verificado_por,

    totalVisualizacoes: registro.total_visualizacoes,
    totalContatos: registro.total_contatos,
    ultimaAtividadeEm: registro.ultima_atividade_em,
    criadoEm: registro.criado_em,
    atualizadoEm: registro.atualizado_em,
  };
};

/**
 * Linha da tabela de ligação (perfil_servicos, perfil_marcas,
 * perfil_areas_atendimento), devolvida pelas rotas de vínculo.
 *
 * É a visão "o que eu marquei", sem o catálogo junto: quem edita já tem a
 * lista de serviços na tela e só precisa saber quais estão ligados. Trazer o
 * catálogo aqui seria um join a mais para repetir dado que o cliente já tem.
 */
const vinculo = (registro) => {
  const dado = registro.get ? registro.get({ plain: true }) : registro;

  return {
    id: dado.id,
    servicoId: dado.servico_id,
    marcaId: dado.marca_id,
    municipioId: dado.municipio_id,
    precoReferenciaCentavos: dado.preco_referencia_centavos,
    taxaDeslocamentoCentavos: dado.taxa_deslocamento_centavos,
    observacao: dado.observacao,
    principal: dado.principal,
    autorizada: dado.autorizada,
  };
};

module.exports = {
  publico,
  privado,
  item,
  vinculo,
  horario,
  servico,
  marca,
  cultura,
  maquina,
  endereco,
  areaAtendimento,
  municipio,
};
