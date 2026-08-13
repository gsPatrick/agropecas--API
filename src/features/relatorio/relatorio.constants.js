'use strict';

/**
 * Vocabulário e tetos do módulo de relatórios.
 *
 * Relatório é a rota mais cara da API: cada consulta agrega tabelas inteiras.
 * As constantes daqui existem para que o custo seja LIMITADO POR CONTRATO, e
 * não pela boa vontade de quem monta a query no front.
 */

/**
 * Teto de período: 366 dias por consulta.
 *
 * Sem teto, `de=2000-01-01` vira varredura completa em `busca_logs` e
 * `anuncio_metricas_diarias`, e basta um F5 para repetir. 366 (e não 365)
 * porque "o ano passado inteiro" num ano bissexto é um pedido legítimo e seria
 * frustrante recusar por um dia.
 *
 * Quem precisa de série histórica maior usa a EXPORTAÇÃO, que roda na fila e
 * não segura conexão de banco no caminho da resposta.
 */
const PERIODO_MAX_DIAS = 366;

/** exportação pode ir mais longe justamente por ser assíncrona */
const PERIODO_MAX_DIAS_EXPORTACAO = 1096; // ~3 anos

/**
 * Piso de agregação: recorte com menos que isto não é publicado.
 *
 * Número agregado sobre uma pessoa só NÃO É número agregado — é dado pessoal
 * com outro nome. "3 buscas por 'bomba injetora Valtra BH180' em Nova Mutum"
 * identifica o produtor que fez a busca para quem conhece a região.
 *
 * O piso vale para os recortes que cruzam TERMO com LOCALIDADE, que são os que
 * reidentificam. Contagem global de plataforma ("42 anúncios publicados") não
 * fala de indivíduo e não passa por aqui.
 *
 * 5 é o piso usual de divulgação estatística (mesma ordem de grandeza da
 * regra de célula pequena usada por institutos de pesquisa). As linhas
 * suprimidas viram um total agregado em `ocultados`, para que o Admin saiba
 * que existe cauda e não tome a lista por completa.
 */
const MINIMO_AGREGACAO = 5;

/** teto de linhas em qualquer "top N" — protege a resposta e a tela */
const TOP_MAXIMO = 50;
const TOP_PADRAO = 20;

/**
 * TTL do cache de relatório.
 *
 * 5 minutos. Relatório não é painel operacional: a cliente olha número para
 * decidir onde investir, não para reagir ao minuto. Cinco minutos absorvem a
 * rajada de quem troca o filtro de período várias vezes seguidas — o caso real
 * que derruba banco em painel administrativo.
 */
const TTL = {
  PAINEL: 300,
  DESEMPENHO: 300,
  BUSCA: 600,

  /**
   * Números públicos da home: 10 minutos.
   *
   * TTL mais longo que o do painel, e por um motivo diferente. O painel é
   * consultado por um punhado de administradores; ESTE é a página mais
   * visitada do produto, e cada visita sem cache seria um `COUNT` em `perfis`
   * e outro em `anuncios` — tabelas que só crescem. Com 10 minutos, o pior
   * caso é 6 pares de COUNT por hora, independentemente do tráfego.
   *
   * A defasagem é irrelevante: ninguém decide nada por "+500" ter virado
   * "+501" dez minutos antes. O que não pode é a home dar erro ou demorar, e
   * cache curto demais em página de entrada é exatamente como se derruba o
   * banco no dia em que a divulgação funciona.
   */
  PUBLICO: 600,
};

const GRANULARIDADES = ['dia', 'semana', 'mes'];

const RELATORIOS_EXPORTAVEIS = ['painel', 'desempenho', 'busca'];

const FORMATOS = ['csv'];

/** validade do link de download gerado pela fila */
const EXPORTACAO_VALIDADE_HORAS = 24;

module.exports = {
  PERIODO_MAX_DIAS,
  PERIODO_MAX_DIAS_EXPORTACAO,
  MINIMO_AGREGACAO,
  TOP_MAXIMO,
  TOP_PADRAO,
  TTL,
  GRANULARIDADES,
  RELATORIOS_EXPORTAVEIS,
  FORMATOS,
  EXPORTACAO_VALIDADE_HORAS,
};
