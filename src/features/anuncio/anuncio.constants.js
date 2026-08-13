'use strict';

/**
 * Vocabulários fechados da feature.
 *
 * Ficam fora dos services porque prazo, chave de configuração e nome de
 * trabalho da fila são citados em três arquivos diferentes — string mágica
 * repetida é o jeito garantido de corrigir só uma delas no dia da mudança.
 */

/** chaves lidas da tabela `configuracoes` (o Admin muda sem deploy) */
const CONFIG = {
  DIAS_VALIDADE: 'anuncio.dias_validade',
  MAX_ATIVOS: 'anuncio.max_ativos_por_usuario',
  MAX_FOTOS: 'anuncio.max_fotos',
  MODERACAO_PREVIA: 'anuncio.moderacao_previa',
  PRODUTOR_APROXIMADA: 'localizacao.produtor_aproximada',
};

/** valores usados quando a linha de configuração não existe (banco novo) */
const PADRAO = {
  DIAS_VALIDADE: 60,
  MAX_FOTOS: 8,
  MODERACAO_PREVIA: false,
};

/** chaves de `plano_limites` que este módulo consulta */
const LIMITE = {
  ANUNCIOS_ATIVOS: 'anuncios.ativos',
  FOTOS_POR_ANUNCIO: 'fotos.por_anuncio',
};

/** trabalhos da fila deste domínio — namespace `anuncio.*` */
const TRABALHOS = {
  REINDEXAR: 'anuncio.reindexar',
  REGISTRAR_VISUALIZACAO: 'anuncio.registrarVisualizacao',
  REGISTRAR_CONTATO: 'anuncio.registrarContato',
  EXPIRAR: 'anuncio.expirar',
};

/**
 * Transições de status permitidas.
 *
 * Declarar o grafo evita o `if` em cascata que sempre esquece um caso — como
 * "renovar anúncio removido", que republicaria conteúdo que o Admin tirou do ar.
 */
const TRANSICOES = {
  publicar: { de: ['rascunho', 'pausado', 'expirado'], para: 'publicado' },
  pausar: { de: ['publicado'], para: 'pausado' },
  renovar: { de: ['publicado', 'pausado', 'expirado'], para: 'publicado' },
  ocultar: { de: ['rascunho', 'publicado', 'pausado', 'expirado'], para: 'oculto' },
};

/** status que contam contra o limite do plano */
const STATUS_ATIVOS = ['publicado', 'pausado'];

/**
 * Janela de deduplicação da visualização, em segundos.
 *
 * Sem janela, F5 vira métrica: o anunciante veria 300 visitas de uma pessoa só
 * e tomaria decisão comercial em cima de ruído. Seis horas é o intervalo em que
 * a mesma pessoa voltando ao anúncio ainda é a mesma visita.
 */
const JANELA_VISUALIZACAO_SEGUNDOS = 6 * 60 * 60;

/** TTL do cache — curto de propósito: vitrine desatualizada é reclamação certa */
const TTL = {
  VITRINE: 60,
  DETALHE: 120,
  PARECIDOS: 300,
  CONFIGURACAO: 300,
};

/** colunas trazidas na LISTAGEM — `descricao` (TEXT) fica de fora de propósito */
const CAMPOS_LISTA = [
  'id',
  'codigo',
  'slug',
  'tipo',
  'titulo',
  'condicao',
  'negociacao',
  'preco_centavos',
  'preco_a_combinar',
  'aceita_troca',
  'moeda',
  'uf',
  'municipio_id',
  'precisao_localizacao',
  'status',
  'publicado_em',
  'expira_em',
  'destaque_ate',
  'total_visualizacoes',
  'total_favoritos',
  'categoria_id',
  'marca_id',
  'usuario_id',
  'perfil_id',
  'criado_em',
];

/** só para `GET /anuncios/meus`: o dono vê quantos contatos cada linha já
    recebeu, sem pagar o custo de carregar isso na vitrine pública inteira */
const CAMPOS_LISTA_MEUS = [...CAMPOS_LISTA, 'total_contatos_whatsapp', 'total_contatos_chat'];

/** canais de contato aceitos pelo endpoint público */
const CANAIS_CONTATO = ['whatsapp', 'chat', 'telefone', 'email'];

module.exports = {
  CONFIG,
  PADRAO,
  LIMITE,
  TRABALHOS,
  TRANSICOES,
  STATUS_ATIVOS,
  JANELA_VISUALIZACAO_SEGUNDOS,
  TTL,
  CAMPOS_LISTA,
  CAMPOS_LISTA_MEUS,
  CANAIS_CONTATO,
};
