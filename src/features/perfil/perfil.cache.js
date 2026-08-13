'use strict';

const cache = require('../../cache');
const { base } = require('../../cache/chaves');

/**
 * Chaves de cache da feature (padrão do PADRAO_MODULO §7).
 *
 * Moram aqui e não em `cache/chaves.js` para que dois módulos escritos em
 * paralelo não disputem o mesmo arquivo. O prefixo continua sendo o comum, o
 * que mantém `invalidar(dominio())` funcionando para o domínio inteiro.
 *
 * O perfil público é a rota mais lida do sistema (é a página que o Google
 * indexa) e a mais barata de cachear: muda pouco, é lida por quem não está
 * logado e o conteúdo é idêntico para todo visitante.
 */

const chaves = {
  /** detalhe público, por slug — é assim que a rota chega */
  detalhe: (slug) => `${base()}:perfil:${slug}`,
  lista: (assinatura) => `${base()}:perfis:lista:${assinatura}`,
  dominio: () => `${base()}:perfi*`,
};

/**
 * Invalidação na escrita. TTL é rede de segurança, não estratégia: quem
 * corrige o telefone precisa ver a correção agora, não em cinco minutos.
 *
 * A listagem cai inteira porque qualquer campo do perfil pode participar de um
 * filtro (tipo, município, verificado) — invalidar seletivamente exigiria
 * saber quais assinaturas existem, e isso é caro e frágil.
 */
async function invalidar(perfil) {
  const alvos = [];
  if (perfil?.slug) alvos.push(chaves.detalhe(perfil.slug));

  await cache.remover(alvos);
  await cache.invalidar(`${base()}:perfis:lista:*`);
}

module.exports = { chaves, invalidar };
