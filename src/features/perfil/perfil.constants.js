'use strict';

/**
 * Constantes da feature de perfil.
 *
 * O que mora aqui são os vocabulários fechados e as decisões que precisam ser
 * lidas por mais de um service — principalmente **quais campos pertencem a
 * qual tipo de perfil**. Espalhar essa lista pelos services é o caminho curto
 * para um produtor acabar com `raio_atendimento_km` preenchido.
 */

/** campos que qualquer um dos três tipos pode editar */
const CAMPOS_COMUNS = [
  'nome_exibicao',
  'bio',
  'foto_url',
  'capa_url',
  'site',
  'instagram',
  'facebook',
  'whatsapp',
  'telefone_secundario',
  'email_publico',
  'exibir_whatsapp',
  'exibir_endereco_exato',
  'aceita_chat',
  'municipio_id',
];

/**
 * Campos exclusivos de cada tipo. O discriminador é `perfis.tipo` e a tabela
 * é a mesma para os três (ver `src/models/perfil.js`), então nada além do
 * código impede um produtor de gravar `inscricao_estadual`. Este mapa É esse
 * impedimento.
 */
const CAMPOS_POR_TIPO = {
  produtor: ['propriedade_nome', 'area_hectares'],
  loja: [
    'razao_social',
    'nome_fantasia',
    'inscricao_estadual',
    'entrega_observacao',
    'formas_entrega',
    'raio_entrega_km',
    'prazo_resposta_horas',
  ],
  prestador: ['atende_no_campo', 'raio_atendimento_km', 'formas_atendimento'],
};

/**
 * Campos que NUNCA podem chegar pelo corpo da requisição, nem do dono nem do
 * Admin. O validador já descarta desconhecido (`.strip()`), mas a lista existe
 * para quem for adicionar campo ao esquema um dia: `verificado_em` no corpo é
 * exatamente como um usuário se auto-verificaria.
 */
const CAMPOS_BLOQUEADOS = [
  'id',
  'usuario_id',
  'tipo',
  'slug',
  'documento',
  'documento_tipo',
  'pessoa_tipo',
  'verificado_em',
  'verificado_por',
  'verificacao_observacao',
  'total_anuncios',
  'total_anuncios_ativos',
  'total_visualizacoes',
  'total_contatos',
  'membro_desde',
  'endereco_id',
  'uf',
];

/** só loja e prestador têm horário de atendimento — produtor não é ponto comercial */
const TIPOS_COM_HORARIO = ['loja', 'prestador'];

/** 0 = domingo, como no model e no `Date.getDay()` do JavaScript */
const DIAS_SEMANA = [0, 1, 2, 3, 4, 5, 6];

/**
 * Coleções N:N gerenciadas por este módulo.
 *
 * Um mapa em vez de três services quase idênticos: vincular serviço, marca e
 * município é a mesma mecânica (conjunto, com colunas extras na tabela de
 * ligação). O que muda é o nome da coluna e quais extras existem.
 *
 * `somenteAdmin` lista extras que o dono do perfil NÃO pode gravar sozinho —
 * "revenda autorizada" é selo, não autodeclaração.
 */
const COLECOES = {
  servicos: {
    ligacao: 'PerfilServico',
    alvo: 'Servico',
    coluna: 'servico_id',
    extras: ['preco_referencia_centavos', 'observacao', 'principal'],
    somenteAdmin: [],
    rotulo: 'Serviço',
  },
  marcas: {
    ligacao: 'PerfilMarca',
    alvo: 'Marca',
    coluna: 'marca_id',
    extras: ['autorizada'],
    somenteAdmin: ['autorizada'],
    rotulo: 'Marca',
  },
  'area-atendimento': {
    ligacao: 'PerfilAreaAtendimento',
    alvo: 'Municipio',
    coluna: 'municipio_id',
    extras: ['taxa_deslocamento_centavos', 'observacao'],
    somenteAdmin: [],
    rotulo: 'Município',
  },
};

/**
 * Teto de itens por coleção. Não é limite de produto — é limite de abuso:
 * sem ele, um POST com 5.000 municípios vira uma listagem pública que nenhum
 * cache salva.
 */
const MAXIMO_POR_COLECAO = 200;

/**
 * Coleções que o PATCH do perfil sincroniza junto com os campos simples.
 *
 * A tela do painel salva o formulário INTEIRO num PATCH — não faz uma chamada
 * por coleção. Sem isto, o produtor salvava "Minha propriedade" e culturas e
 * maquinário sumiam no refresh, e o prestador salvava "Meus serviços" sem que
 * nada fosse gravado.
 *
 * `tipos: null` significa "qualquer tipo de perfil". Culturas e maquinário são
 * do produtor porque descrevem a propriedade; mandados por uma loja, são
 * descartados em silêncio e voltam em `camposIgnorados`, no mesmo critério dos
 * campos exclusivos de tipo.
 */
const COLECOES_NO_PATCH = {
  culturas: { tipos: ['produtor'], service: 'cultura' },
  maquinas: { tipos: ['produtor'], service: 'maquina' },
  /* serviços não são só do prestador: loja que faz instalação também presta.
     A rota `PUT /perfis/meu/servicos` nunca restringiu por tipo, e divergir
     aqui criaria duas regras para o mesmo dado */
  servicos: { tipos: null, service: 'servico' },
};

/** teto de itens das coleções novas — limite de abuso, não de produto */
const MAXIMO_CULTURAS = 30;
const MAXIMO_MAQUINAS = 100;

/**
 * Tipos de máquina da frota. Repetido do ENUM de `perfil_maquinas` de propósito:
 * o validador precisa da lista e importar `models/constantes.js` para isso
 * colocaria um vocabulário desta feature num arquivo compartilhado por todas.
 * A lista é a MESMA de `maquinas.categoria_maquina` — divergir faria o filtro do
 * catálogo não bater com o da frota.
 */
const TIPOS_MAQUINA = [
  'trator',
  'colheitadeira',
  'pulverizador',
  'plantadeira',
  'implemento',
  'caminhao',
  'motor',
  'outro',
];

/** como a loja entrega o que vende — ver `formas_entrega` em `perfis` */
const FORMAS_ENTREGA = ['retirada', 'regiao', 'transportadora', 'campo'];

/** onde o prestador atende — ver `formas_atendimento` em `perfis` */
const FORMAS_ATENDIMENTO = ['campo', 'oficina', 'emergencia'];

/** slugs que a API usa como rota fixa e que, por isso, nenhum perfil pode ter */
const SLUGS_RESERVADOS = ['meu', 'eu', 'novo', 'admin', 'api', 'buscar'];

/** TTL do perfil público. Curto o bastante para uma correção aparecer rápido,
 *  longo o bastante para segurar o pico de tráfego vindo do Google. */
const TTL_PERFIL_SEGUNDOS = 300;
const TTL_LISTA_SEGUNDOS = 60;

module.exports = {
  CAMPOS_COMUNS,
  CAMPOS_POR_TIPO,
  CAMPOS_BLOQUEADOS,
  TIPOS_COM_HORARIO,
  DIAS_SEMANA,
  COLECOES,
  COLECOES_NO_PATCH,
  MAXIMO_POR_COLECAO,
  MAXIMO_CULTURAS,
  MAXIMO_MAQUINAS,
  TIPOS_MAQUINA,
  FORMAS_ENTREGA,
  FORMAS_ATENDIMENTO,
  SLUGS_RESERVADOS,
  TTL_PERFIL_SEGUNDOS,
  TTL_LISTA_SEGUNDOS,
};
