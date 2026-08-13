'use strict';

const { campos, esquema } = require('../../validacao');
const { PERFIL_TIPO } = require('../../models/constantes');
const {
  DIAS_SEMANA,
  MAXIMO_POR_COLECAO,
  COLECOES,
  MAXIMO_CULTURAS,
  MAXIMO_MAQUINAS,
  TIPOS_MAQUINA,
  FORMAS_ENTREGA,
  FORMAS_ATENDIMENTO,
} = require('./perfil.constants');

/**
 * Esquemas de entrada da feature.
 *
 * O esquema é a primeira barreira de mass assignment: o adaptador descarta
 * campo desconhecido, então `verificadoEm`, `slug`, `documento` e os
 * contadores simplesmente **não existem** depois de passar por aqui. Não é
 * preciso confiar no service para isso — mas ele confere de novo, porque
 * segurança que depende de uma camada só é segurança que ainda não falhou.
 *
 * Um esquema único para os três tipos, com todos os campos opcionais: qual
 * campo pertence a qual tipo é decisão de negócio e vive em
 * `perfil.constants.js`, aplicada no service. Fazer isso no validador
 * significaria três esquemas quase iguais e uma regra em dois lugares.
 */

const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const hora = () => campos.texto().padraoTexto(HORA, 'Use o formato HH:MM.');

/**
 * Bloco de endereço, reaproveitado pelo cadastro (`auth.validators`) e pela
 * edição de perfil.
 *
 * Declarado uma vez porque o formulário é o mesmo nas duas telas: duplicar
 * significaria que um dia o cadastro aceitaria `complemento` e a edição não, e
 * ninguém descobriria até o suporte receber a reclamação.
 *
 * `latitude`/`longitude` NÃO entram: coordenada exata se marca no mapa, na
 * feature de localização, que deriva a precisão da origem. Aceitar ponto de um
 * campo digitado daria selo de "exata" a coordenada que ninguém conferiu.
 */
const enderecoCampos = {
  cep: campos.cep().permitindoNulo(),
  logradouro: campos.texto().max(200).permitindoNulo(),
  numero: campos.texto().max(20).permitindoNulo(),
  complemento: campos.texto().max(120).permitindoNulo(),
  bairro: campos.texto().max(120).permitindoNulo(),
  referencia: campos.texto().max(200).permitindoNulo(),
};

/**
 * Uma máquina da frota.
 *
 * `marca` é TEXTO e não uuid porque a regra de produto é explícita: implemento
 * de fabricante pequeno precisa entrar. O service casa o texto com o catálogo
 * quando existe e guarda livre quando não — recusar aqui mataria o caso de uso.
 *
 * `id` é opcional e só faz sentido quando é o UUID que a API devolveu; o front
 * gera ids locais para a lista da tela e o service ignora o que não for UUID.
 */
const maquinaItem = () =>
  campos.objeto({
    id: campos.texto().max(64),
    tipo: campos.umDe(TIPOS_MAQUINA),
    marca: campos.texto().obrigatorio('Informe a marca da máquina.').min(1).max(100),
    marcaId: campos.uuid(),
    modelo: campos.texto().obrigatorio('Informe o modelo da máquina.').min(1).max(120),
    /* faixa igual à constraint do banco: reprovar aqui dá mensagem no campo,
       reprovar lá dá erro 500 com texto de Postgres */
    ano: campos.inteiro().min(1950).max(2100),
    identificacao: campos.texto().max(60),
    observacao: campos.texto().max(255),
    maquinaId: campos.uuid(),
  });

const atualizar = esquema({
  // ── comuns aos três tipos ──────────────────────────────────
  nomeExibicao: campos.texto().min(2).max(160),
  bio: campos.textoLongo().max(2000),
  fotoUrl: campos.texto().max(500),
  capaUrl: campos.texto().max(500),
  site: campos.texto().max(255),
  instagram: campos.texto().max(120),
  facebook: campos.texto().max(120),

  whatsapp: campos.telefone().comoE164().permitindoNulo(),
  telefoneSecundario: campos.telefone().comoE164().permitindoNulo(),
  emailPublico: campos.email().permitindoNulo(),

  /* consentimento LGPD, não preferência de UI — ver perfil.mapper.js */
  exibirWhatsapp: campos.booleano(),
  exibirEnderecoExato: campos.booleano(),
  aceitaChat: campos.booleano(),

  municipioId: campos.uuid().permitindoNulo(),

  /* endereço completo. Até aqui só o município era gravado e o resto do
     formulário se perdia — o CEP e o logradouro voltavam em branco na tela */
  endereco: campos.objeto(enderecoCampos),

  // ── produtor ───────────────────────────────────────────────
  propriedadeNome: campos.texto().max(160).permitindoNulo(),
  areaHectares: campos.numero().min(0).max(10000000).permitindoNulo(),

  /* rótulo, slug ou uuid — o service resolve contra o catálogo `culturas`.
     Aceitar o rótulo é o que deixa a tela mandar o que ela já exibe */
  culturas: campos
    .lista(campos.texto().min(1).max(140))
    .max(MAXIMO_CULTURAS, `No máximo ${MAXIMO_CULTURAS} culturas.`),

  maquinas: campos
    .lista(maquinaItem())
    .max(MAXIMO_MAQUINAS, `No máximo ${MAXIMO_MAQUINAS} máquinas.`),

  // ── prestador (e loja que também presta) ───────────────────
  /* a lista de serviços prestados; uuid, slug ou nome do catálogo */
  servicos: campos
    .lista(campos.texto().min(1).max(140))
    .max(MAXIMO_POR_COLECAO, `No máximo ${MAXIMO_POR_COLECAO} serviços.`),

  // ── loja ───────────────────────────────────────────────────
  razaoSocial: campos.texto().max(180).permitindoNulo(),
  nomeFantasia: campos.texto().max(180).permitindoNulo(),
  inscricaoEstadual: campos.texto().max(30).permitindoNulo(),
  entregaObservacao: campos.textoLongo().max(2000).permitindoNulo(),
  formasEntrega: campos.lista(campos.umDe(FORMAS_ENTREGA)).max(FORMAS_ENTREGA.length),
  raioEntregaKm: campos.inteiro().min(0).max(2000).permitindoNulo(),
  prazoRespostaHoras: campos.inteiro().min(0).max(168).permitindoNulo(),

  // ── prestador ──────────────────────────────────────────────
  atendeNoCampo: campos.booleano(),
  raioAtendimentoKm: campos.inteiro().min(0).max(2000).permitindoNulo(),
  formasAtendimento: campos.lista(campos.umDe(FORMAS_ATENDIMENTO)).max(FORMAS_ATENDIMENTO.length),
});

/**
 * Semana inteira de uma vez. `PUT` e não `PATCH` porque horário de
 * funcionamento é lido como bloco ("seg a sex 8-18, sáb 8-12"): editar dia a
 * dia deixaria a tela em estado intermediário inconsistente entre dois
 * salvamentos.
 */
const definirHorarios = esquema({
  horarios: campos
    .lista(
      campos.objeto({
        diaSemana: campos
          .inteiro()
          .obrigatorio('Informe o dia da semana.')
          .min(Math.min(...DIAS_SEMANA))
          .max(Math.max(...DIAS_SEMANA)),
        fechado: campos.booleano().padrao(false),
        abreAs: hora(),
        fechaAs: hora(),
        intervaloInicio: hora(),
        intervaloFim: hora(),
      })
    )
    .obrigatorio('Informe os horários.')
    .max(7, 'A semana tem sete dias.'),
});

const identificador = esquema({ id: campos.uuid().obrigatorio('Identificador inválido.') });

const slugParam = esquema({
  slug: campos
    .texto()
    .obrigatorio('Informe o perfil.')
    .max(160)
    .padraoTexto(/^[a-z0-9-]+$/, 'Endereço de perfil inválido.'),
});

const diaParam = esquema({
  /* vem da URL como texto; `inteiro` já converte (o adaptador usa coerce) */
  dia: campos
    .inteiro()
    .obrigatorio('Informe o dia da semana.')
    .min(Math.min(...DIAS_SEMANA))
    .max(Math.max(...DIAS_SEMANA)),
});

const colecaoParam = esquema({
  colecao: campos.umDe(Object.keys(COLECOES)).obrigatorio('Coleção inválida.'),
});

const colecaoItemParam = esquema({
  colecao: campos.umDe(Object.keys(COLECOES)).obrigatorio('Coleção inválida.'),
  alvoId: campos.uuid().obrigatorio('Identificador inválido.'),
});

/** substitui o conjunto inteiro — o teto existe para não virar vetor de abuso */
const definirColecao = esquema({
  itens: campos
    .lista(
      campos.objeto({
        id: campos.uuid().obrigatorio('Identificador inválido.'),
        precoReferenciaCentavos: campos.inteiro().min(0),
        taxaDeslocamentoCentavos: campos.inteiro().min(0),
        observacao: campos.texto().max(255),
        principal: campos.booleano(),
        autorizada: campos.booleano(),
      })
    )
    .obrigatorio('Informe os itens.')
    .max(MAXIMO_POR_COLECAO, `No máximo ${MAXIMO_POR_COLECAO} itens.`),
});

const vincular = esquema({
  id: campos.uuid().obrigatorio('Identificador inválido.'),
  precoReferenciaCentavos: campos.inteiro().min(0),
  taxaDeslocamentoCentavos: campos.inteiro().min(0),
  observacao: campos.texto().max(255),
  principal: campos.booleano(),
  autorizada: campos.booleano(),
});

/**
 * Verificação (o selo). A observação é obrigatória de propósito: o selo é um
 * atestado da plataforma sobre um terceiro, e "por que este perfil foi
 * verificado" precisa estar escrito em algum lugar quando alguém contestar.
 */
const verificar = esquema({
  observacao: campos.texto().obrigatorio('Explique o motivo da verificação.').min(3).max(500),
});

const remover = esquema({ motivo: campos.texto().max(500) });

const listagem = esquema({
  tipo: campos.umDe(PERFIL_TIPO),
  municipioId: campos.uuid(),
  uf: campos.texto().minusculo().tamanho(2, 'UF inválida.'),
  servicoId: campos.uuid(),
  marcaId: campos.uuid(),
  atendeMunicipioId: campos.uuid(),
  verificado: campos.booleano(),
  q: campos.texto().max(120),
  ordenar: campos.umDe(['recentes', 'anuncios', 'nome']).padrao('recentes'),
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(50),
});

module.exports = {
  enderecoCampos,
  atualizar,
  definirHorarios,
  definirColecao,
  vincular,
  verificar,
  remover,
  listagem,
  identificador,
  slugParam,
  diaParam,
  colecaoParam,
  colecaoItemParam,
};
