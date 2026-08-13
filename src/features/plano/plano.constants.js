'use strict';

/**
 * Vocabulário fechado do módulo de plano.
 *
 * O MVP é gratuito (Maturacao/01, §3). Este módulo NÃO cobra: ele existe para
 * que ligar cobrança um dia seja alterar o VALOR de um limite, não reescrever
 * o núcleo. Nenhum gateway de pagamento entra aqui.
 */

/**
 * Chaves de limite conhecidas pela plataforma.
 *
 * A lista é o contrato com os outros módulos: `anuncio` pergunta por
 * `anuncios.ativos`, `midia` por `fotos.por_anuncio`. Manter o vocabulário
 * fechado evita o cenário em que um módulo grava uso em `anuncio_ativo` e o
 * outro consulta `anuncios.ativos` — dois contadores que nunca se encontram.
 *
 * Chave desconhecida NÃO é erro: um módulo novo pode consultar antes de o
 * Admin cadastrar o limite. Nesse caso a resposta é "ilimitado", que é o
 * comportamento correto no MVP gratuito (ver `plano.limite.service.js`).
 */
const LIMITES = {
  ANUNCIOS_ATIVOS: 'anuncios.ativos',
  ANUNCIOS_POR_MES: 'anuncios.por_mes',
  FOTOS_POR_ANUNCIO: 'fotos.por_anuncio',
  DESTAQUES_POR_MES: 'destaques.por_mes',
};

const CHAVES_CONHECIDAS = Object.values(LIMITES);

/** períodos aceitos pelo model `plano_limites` */
const PERIODOS = ['total', 'dia', 'semana', 'mes'];

const PERIODICIDADES = ['mensal', 'trimestral', 'anual', 'vitalicio'];

/** status de assinatura que dão direito ao plano */
const STATUS_VIGENTES = ['ativa', 'periodo_teste'];

/** chave do plano semeado em `seeders/20260810000000-rbac-e-base.js` */
const PLANO_PADRAO = 'gratuito_mvp';

/**
 * TTLs de cache.
 *
 * `podeUsar` roda em toda publicação de anúncio e em todo upload de foto, e as
 * duas metades da resposta envelhecem em ritmos diferentes:
 *
 * - **limites** mudam quando o Admin edita o plano ou troca a assinatura de
 *   alguém — raro, e ambas as operações invalidam a chave explicitamente. Por
 *   isso 5 minutos: o TTL é rede de segurança, não a estratégia.
 * - **uso** muda a cada publicação. 20s é curto o bastante para que um erro de
 *   invalidação não deixe ninguém publicando além da conta por muito tempo, e
 *   longo o bastante para absorver a rajada de uploads de um mesmo anúncio.
 */
const TTL = {
  PLANOS_PUBLICOS: 300,
  LIMITES_DO_USUARIO: 300,
  USO: 20,
};

/**
 * Ações registradas em `logs_auditoria`.
 *
 * `logs_auditoria.acao` é um ENUM do Postgres com um vocabulário curto e
 * genérico (`criar`, `editar`, `remover`…) — ver `models/constantes.js`.
 * Ampliá-lo exigiria migration, e migration é território do orquestrador.
 *
 * Então o QUE aconteceu vem do par (acao, entidade): definir limite e trocar a
 * assinatura de alguém são os dois `editar`, mas em `plano` e `assinatura`
 * respectivamente, e o `antes`/`depois` diz o resto. Fica registrado no
 * relatório final o pedido de valores próprios (`plano_atribuir`), que
 * tornariam a consulta da trilha bem mais direta.
 */
const AUDITORIA = {
  CRIAR: 'criar',
  EDITAR: 'editar',
  REMOVER: 'remover',
  LIMITES_DEFINIR: 'editar',
  ATRIBUIR: 'editar',
};

/**
 * Normaliza a chave de limite.
 *
 * O documento de produto escreve `anuncios_ativos` e o seeder gravou
 * `anuncios.ativos`. Em vez de exigir que todo módulo consumidor acerte o
 * separador, aceitamos os dois e gravamos sempre com ponto — o custo de errar
 * aqui é um limite que silenciosamente não se aplica, que é o pior tipo de
 * falha de quota: ninguém percebe até a conta chegar.
 */
const normalizarChave = (chave) =>
  String(chave || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '');

module.exports = {
  LIMITES,
  CHAVES_CONHECIDAS,
  PERIODOS,
  PERIODICIDADES,
  STATUS_VIGENTES,
  PLANO_PADRAO,
  TTL,
  AUDITORIA,
  normalizarChave,
};
