'use strict';

const { campos, esquema } = require('../../validacao');
const {
  ANUNCIO_TIPO,
  ANUNCIO_CONDICAO,
  ANUNCIO_NEGOCIACAO,
  ANUNCIO_STATUS,
} = require('../../models/constantes');
const { CANAIS_CONTATO } = require('./anuncio.constants');
const { RAIO_BUSCA_MAX_KM } = require('../localizacao/localizacao.constants');

/**
 * Esquemas de entrada.
 *
 * Duas ausências são propositais e valem mais que qualquer regra presente:
 *
 *  · **`usuarioId` e `perfilId` não existem no esquema de criação.** O dono sai
 *    de `contexto.usuarioId`. Aceitar do corpo seria entregar a autoria de um
 *    anúncio a quem souber digitar um UUID. A única exceção é
 *    `emNomeDeUsuarioId`, que só passa pelo RBAC com `anuncio.criar_em_nome_de`.
 *  · **`status`, `moderacao_status`, `publicado_em`, `total_*` não entram.**
 *    Estado é resultado de ação (publicar, pausar), nunca campo de formulário;
 *    contador é escrito por job.
 *
 * Campo desconhecido é descartado pelo adaptador, então mandar `status` no
 * corpo simplesmente não produz efeito nenhum.
 */

const titulo = () => campos.texto().min(5, 'O título precisa de ao menos 5 caracteres.').max(160);
const descricao = () => campos.textoLongo().max(8000);

/** núcleo compartilhado entre criar e editar — editar só afrouxa obrigatoriedade */
const corpoAnuncio = {
  tipo: campos.umDe(ANUNCIO_TIPO).padrao('peca').rotulo('tipo de anúncio'),
  categoriaId: campos.uuid().permitindoNulo(),
  marcaId: campos.uuid().permitindoNulo(),

  condicao: campos.umDe(ANUNCIO_CONDICAO).padrao('nao_se_aplica'),
  negociacao: campos.umDe(ANUNCIO_NEGOCIACAO).padrao('venda'),

  /* preço em CENTAVOS e inteiro: o front manda 15000 para R$ 150,00. Decimal
     em dinheiro acumula erro de arredondamento e não há motivo para aceitar */
  precoCentavos: campos.inteiro().min(0, 'O preço não pode ser negativo.').permitindoNulo(),
  precoACombinar: campos.booleano().padrao(false),
  aceitaTroca: campos.booleano().padrao(false),

  quantidade: campos.inteiro().min(0).max(1000000),
  unidade: campos.texto().max(20),
  codigoPeca: campos.texto().max(60),

  aceitaEntrega: campos.booleano(),
  entregaObservacao: campos.texto().max(255),
  atendeNoLocal: campos.booleano(),

  enderecoId: campos.uuid().permitindoNulo(),
  municipioId: campos.uuid().permitindoNulo(),
  uf: campos.texto().min(2).max(2).rotulo('UF'),
  latitude: campos.numero().min(-90).max(90),
  longitude: campos.numero().min(-180).max(180),

  seoTitulo: campos.texto().max(180),
  seoDescricao: campos.texto().max(300),

  /* ficha técnica em chave/valor: peça agrícola tem atributo imprevisível
     demais para virar coluna (Maturacao/05 §7.1) */
  atributos: campos.lista(
    campos.objeto({
      chave: campos.texto().obrigatorio().max(60),
      rotulo: campos.texto().max(80),
      valor: campos.texto().obrigatorio().max(255),
      unidade: campos.texto().max(20),
      valorNumerico: campos.numero().permitindoNulo(),
      filtravel: campos.booleano().padrao(false),
    })
  ),

  /** em quais máquinas a peça serve — base do "Busque por máquina" */
  maquinas: campos.lista(campos.uuid()),

  /** ids de `arquivos` já enviados pelo módulo `midia` */
  fotos: campos.lista(campos.uuid()),
};

const criar = esquema({
  ...corpoAnuncio,
  titulo: titulo().obrigatorio('Informe o título do anúncio.'),
  descricao: descricao(),

  /**
   * Publicar em nome de terceiro (Maturacao/05, §2.4).
   * Só tem efeito para quem tem `anuncio.criar_em_nome_de`; o service confere.
   */
  emNomeDeUsuarioId: campos.uuid(),

  /* atalho para o front publicar já na criação, sem uma segunda chamada */
  publicar: campos.booleano().padrao(false),
});

const editar = esquema({
  ...corpoAnuncio,
  titulo: titulo(),
  descricao: descricao(),
});

const publicar = esquema({});

const pausar = esquema({ motivo: campos.texto().max(255) });

const renovar = esquema({});

const ocultar = esquema({
  motivo: campos.texto().obrigatorio('Explique por que o anúncio está sendo ocultado.').max(500),
});

const remover = esquema({ motivo: campos.texto().max(255) });

/** vitrine pública e "meus anúncios" compartilham o vocabulário de filtro */
const listar = esquema({
  pagina: campos.inteiro().min(1).padrao(1),
  porPagina: campos.inteiro().min(1).max(100),
  p: campos.inteiro().min(1),
  pp: campos.inteiro().min(1).max(100),

  tipo: campos.umDe(ANUNCIO_TIPO),
  condicao: campos.umDe(ANUNCIO_CONDICAO),
  negociacao: campos.umDe(ANUNCIO_NEGOCIACAO),
  categoriaId: campos.uuid(),
  marcaId: campos.uuid(),
  maquinaId: campos.uuid(),
  municipioId: campos.uuid(),
  /* nome da cidade porque é o que o front tem em mãos: o ViaCEP e a
     geocodificação reversa do navegador devolvem "Tangará da Serra", não um
     UUID. Exigir `municipioId` obrigaria toda tela a uma chamada extra só para
     traduzir o nome — e a listagem já sabe resolver isso */
  cidade: campos.texto().max(120),
  uf: campos.texto().min(2).max(2),
  perfilId: campos.uuid(),
  usuarioId: campos.uuid(),

  /**
   * Origem da ordenação por proximidade.
   *
   * `lat`/`lng` e não `latitude`/`longitude` porque isto vai na URL de uma
   * listagem pública que o usuário compartilha por WhatsApp — nome curto é o
   * que cabe na prévia do link. A faixa é validada aqui e não no service:
   * coordenada fora do planeta é entrada inválida (422), não resultado vazio.
   */
  lat: campos.numero().min(-90, 'Latitude fora da faixa válida.').max(90, 'Latitude fora da faixa válida.'),
  lng: campos
    .numero()
    .min(-180, 'Longitude fora da faixa válida.')
    .max(180, 'Longitude fora da faixa válida.'),
  /* o teto não é arbitrário: 1000 km é a largura de Mato Grosso. Raio maior
     que isso deixa de ser filtro e vira varredura da tabela inteira */
  raioKm: campos.numero().min(1).max(RAIO_BUSCA_MAX_KM, `O raio máximo é de ${RAIO_BUSCA_MAX_KM} km.`),

  precoMin: campos.inteiro().min(0),
  precoMax: campos.inteiro().min(0),
  aceitaTroca: campos.booleano(),
  aceitaEntrega: campos.booleano(),

  /**
   * Só os destacados (`true`) ou só os comuns (`false`).
   *
   * Omitir o campo continua trazendo os dois — e é o padrão de propósito: a
   * vitrine sem filtro tem de continuar mostrando o anúncio de quem não pagou
   * destaque, senão o produto vira mural de patrocinado no dia em que a
   * primeira loja comprar o plano.
   *
   * `destaque` não é coluna: é `destaque_ate` ainda no futuro. Quem traduz é o
   * service, no mesmo lugar em que o mapper já traduz na saída.
   */
  destaque: campos.booleano(),

  /* `proximidade` exige origem (lat/lng, cidade ou municipioId); sem ela o
     service cai em `recentes` em vez de devolver erro — a vitrine é a porta de
     entrada pública e uma tela em branco por falta de GPS é pior que uma lista
     fora de ordem */
  ordenar: campos
    .umDe(['recentes', 'antigos', 'preco_asc', 'preco_desc', 'populares', 'proximidade'])
    .padrao('recentes'),
});

const listarMeus = esquema({
  pagina: campos.inteiro().min(1).padrao(1),
  porPagina: campos.inteiro().min(1).max(100),
  status: campos.umDe(ANUNCIO_STATUS),
  tipo: campos.umDe(ANUNCIO_TIPO),
  ordenar: campos.umDe(['recentes', 'antigos', 'populares']).padrao('recentes'),
});

const vincularFotos = esquema({
  arquivos: campos.lista(campos.uuid()).obrigatorio('Informe ao menos um arquivo.'),
});

const reordenarFotos = esquema({
  ordem: campos.lista(campos.uuid()).obrigatorio('Informe a nova ordem das fotos.'),
});

const registrarContato = esquema({
  canal: campos.umDe(CANAIS_CONTATO).obrigatorio('Informe o canal do contato.'),
  origem: campos.texto().max(40),
});

const periodo = esquema({
  de: campos.data(),
  ate: campos.data(),
  dias: campos.inteiro().min(1).max(365).padrao(30),
});

const identificador = esquema({ id: campos.uuid().obrigatorio('Identificador inválido.') });

const identificadorFoto = esquema({
  id: campos.uuid().obrigatorio('Identificador inválido.'),
  fotoId: campos.uuid().obrigatorio('Identificador da foto inválido.'),
});

module.exports = {
  criar,
  editar,
  publicar,
  pausar,
  renovar,
  ocultar,
  remover,
  listar,
  listarMeus,
  vincularFotos,
  reordenarFotos,
  registrarContato,
  periodo,
  identificador,
  identificadorFoto,
};
