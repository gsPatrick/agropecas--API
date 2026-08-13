'use strict';

const { base } = require('../../../cache/chaves');
const cache = require('../../../cache');
const { pode, escopoDe } = require('../../../rbac');
const { erros } = require('../../../utils/erros');

/**
 * Peças comuns aos services do painel.
 *
 * Não é service: não implementa caso de uso nenhum. É a cola entre
 * `admin.painel.*` e `admin.usuarios.*` — chave de cache, teste de escopo e
 * projeção de linha. Repetir isso em seis arquivos seria garantir que um deles
 * cacheasse com chave diferente da que os outros invalidam, e cache que
 * ninguém consegue derrubar é pior que nenhum cache.
 */

/**
 * Chaves do painel.
 *
 * Moram aqui, e não em `cache/chaves.js`, porque o padrão do projeto manda a
 * feature ser dona das próprias chaves (PADRÃO_MODULO §7) — assim dois módulos
 * escritos em paralelo não disputam o mesmo arquivo.
 */
const chaves = {
  /** o resumo depende de QUEM pergunta: cada perfil vê um conjunto de cards */
  resumo: (assinatura) => `${base()}:admin:painel:resumo:${assinatura}`,
  pendencias: (assinatura) => `${base()}:admin:painel:pendencias:${assinatura}`,
  metricas: (assinatura) => `${base()}:admin:painel:metricas:${assinatura}`,
  dominio: () => `${base()}:admin:painel*`,
};

/**
 * TTL curto de propósito.
 *
 * O painel é aberto a cada troca de aba e a cada F5, e cada abertura custa meia
 * dúzia de `COUNT(*)` em tabelas grandes. Quarenta e cinco segundos de atraso
 * não mudam a decisão de ninguém que vai trabalhar na fila; o `COUNT` repetido
 * a cada clique muda o tempo de resposta do banco inteiro.
 *
 * As ações do painel invalidam explicitamente — o TTL é a rede de segurança
 * para quando o Redis estiver fora no instante da escrita.
 */
const TTL = { RESUMO: 45, PENDENCIAS: 30, METRICAS: 300 };

/** qualquer escrita do painel mexe em pelo menos um card; derrubar tudo é mais barato que decidir qual */
const invalidarPainel = () => cache.invalidar(chaves.dominio());

/**
 * As telas do painel são montadas por CAPACIDADE, não por papel.
 *
 * O painel não cria poder novo: `admin.acessar` abre a porta, e cada bloco lá
 * dentro só aparece para quem já podia ver aquele recurso na feature original.
 * Um moderador entra e não recebe o card de planos — não porque o front o
 * esconde, mas porque o servidor não o calcula.
 */
function capacidades(contexto) {
  return {
    usuarios: escopoDe(contexto, 'usuario.ler') === 'todos',
    anuncios: escopoDe(contexto, 'anuncio.ler') === 'todos',
    denuncias: escopoDe(contexto, 'denuncia.ler') === 'todos',
    perfis: escopoDe(contexto, 'perfil.ler') === 'todos',
    auditoria: escopoDe(contexto, 'auditoria.ler') === 'todos',
    /* `plano.ler` todo cadastro tem (é a tela de preços). O card de gestão do
       painel se apoia em `plano.editar`, que é o que separa quem administra a
       receita de quem só modera conteúdo */
    planos: pode(contexto, 'plano.editar'),
    /* documento é o dado mais sensível do cadastro: só sai para quem tem a
       permissão de LGPD com escopo total, e sempre com registro de acesso */
    documento: escopoDe(contexto, 'lgpd.acessar_dado_pessoal') === 'todos',
    lgpd: escopoDe(contexto, 'lgpd.ler_solicitacoes') === 'todos',
  };
}

/** assinatura estável do recorte de permissões — entra na chave de cache */
const assinaturaDeCapacidades = (cap) =>
  Object.entries(cap)
    .filter(([, ligado]) => ligado)
    .map(([nome]) => nome)
    .sort()
    .join('+') || 'nenhuma';

/**
 * Tela administrativa exige escopo TOTAL.
 *
 * `autorizar()` na rota confere só a capacidade, e o usuário comum tem
 * `usuario.ler.proprio` — passaria pela rota e receberia uma listagem de um
 * item. Isso é pior que um 403: parece funcionar.
 */
function exigirEscopoTotal(contexto, acao, mensagem) {
  if (escopoDe(contexto, acao) === 'todos') return true;
  throw erros.semPermissao(mensagem || 'Você não tem permissão para esta tela do painel.', {
    permissao: `${acao}.todos`,
  });
}

/** `COUNT` do Postgres volta como string; o front espera número */
const numero = (valor) => Number(valor || 0);

/** janela do dia corrente no fuso do servidor — o "hoje" do resumo */
function hoje() {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

module.exports = {
  chaves,
  TTL,
  invalidarPainel,
  capacidades,
  assinaturaDeCapacidades,
  exigirEscopoTotal,
  numero,
  hoje,
};
