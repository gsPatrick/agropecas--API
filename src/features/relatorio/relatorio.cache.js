'use strict';

const cache = require('../../cache');
const { base } = require('../../cache/chaves');

/**
 * Chaves de cache dos relatórios.
 *
 * O ponto sensível aqui não é desempenho, é **vazamento**: a mesma consulta
 * feita por dois usuários diferentes NÃO devolve a mesma coisa (o anunciante
 * vê só o que é dele). Por isso o escopo entra na chave — um cache de
 * relatório sem o dono na chave é o caminho mais curto para entregar o número
 * do concorrente ao usuário seguinte.
 */

const prefixo = (assunto) => `${base()}:relatorio:${assunto}`;

const chaves = {
  /* `escopo` é 'todos' ou o id do dono; nunca omitir */
  painel: (assinatura) => `${prefixo('painel')}:${assinatura}`,
  desempenho: (escopo, assinatura) => `${prefixo('desempenho')}:${escopo}:${assinatura}`,
  busca: (assinatura) => `${prefixo('busca')}:${assinatura}`,

  /**
   * Números públicos da home.
   *
   * Única chave desta feature SEM escopo, e é seguro justamente porque a
   * resposta não depende de quem pergunta: são quatro contagens globais da
   * plataforma, idênticas para visitante e para administrador. Se algum dia
   * alguém quiser recortar esses números (por UF, por exemplo), a chave passa
   * a precisar de assinatura — do contrário o cache serve o recorte de MT a
   * quem pediu GO.
   */
  publico: () => prefixo('publico'),

  dominio: (assunto) => `${prefixo(assunto)}*`,
};

/**
 * Invalidação é por TTL, não por evento — decisão consciente.
 *
 * Invalidar relatório na escrita significaria derrubar o cache do painel a
 * cada visualização de anúncio registrada, ou seja, cache nenhum. Cinco
 * minutos de defasagem num número que a cliente usa para decidir investimento
 * não muda decisão alguma.
 *
 * Esta função existe para o job de agregação, que roda uma vez por dia e aí
 * sim precisa que a leitura seguinte reflita o consolidado novo.
 */
const invalidarTudo = () =>
  Promise.all(
    ['painel', 'desempenho', 'busca', 'publico'].map((assunto) => cache.invalidar(chaves.dominio(assunto)))
  );

module.exports = { chaves, invalidarTudo };
