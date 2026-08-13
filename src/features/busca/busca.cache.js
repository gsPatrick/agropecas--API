'use strict';

const cache = require('../../cache');
const { base } = require('../../cache/chaves');

/**
 * Chaves de cache da busca.
 *
 * Moram aqui, e não em `src/cache/chaves.js`, porque o padrão §7 manda a chave
 * nova nascer dentro da feature — dois módulos escritos em paralelo não podem
 * disputar o mesmo arquivo.
 *
 * A chave do resultado é montada com `cache.assinatura(filtros)`, que ordena
 * as chaves antes de concatenar: `?uf=MT&q=trator` e `?q=trator&uf=MT` são a
 * mesma busca e precisam cair no mesmo lugar. Sem isso a taxa de acerto
 * despenca sem que ninguém perceba — o cache continua "funcionando", só que
 * nunca acerta.
 */

const prefixo = (assunto) => `${base()}:busca:${assunto}`;

const chaves = {
  resultado: (assinatura) => `${prefixo('resultado')}:${assinatura}`,
  facetas: (assinatura) => `${prefixo('facetas')}:${assinatura}`,
  sugestao: (assinatura) => `${prefixo('sugestao')}:${assinatura}`,
  termosPopulares: (assinatura) => `${prefixo('termos')}:${assinatura}`,
  municipio: (assinatura) => `${prefixo('municipio')}:${assinatura}`,

  dominio: (assunto) => `${prefixo(assunto)}*`,
};

/**
 * Invalidação em massa.
 *
 * A busca não invalida no caminho da escrita: quem publica anúncio é o módulo
 * de anúncio, e obrigá-lo a conhecer as chaves daqui acoplaria os dois. O TTL
 * de 45s é a estratégia assumida (e documentada) para este módulo — a exceção
 * à regra "TTL é rede de segurança". Esta função existe para o Admin poder
 * forçar a limpeza depois de uma moderação em massa.
 */
async function invalidarTudo() {
  await Promise.all(
    ['resultado', 'facetas', 'sugestao', 'termos'].map((assunto) =>
      cache.invalidar(chaves.dominio(assunto))
    )
  );
}

const invalidarTermos = () => cache.invalidar(chaves.dominio('termos'));

module.exports = { chaves, invalidarTudo, invalidarTermos };
