'use strict';

const cache = require('../../cache');
const { erros } = require('../../utils/erros');
const { chaves, identidade } = require('./contato.cache');
const { REVELACAO, JANELA_CONTATO_SEGUNDOS } = require('./contato.constants');

/**
 * Contagem com janela — as duas defesas do módulo num assunto só.
 *
 * Vive aqui, e não no `middlewares/rate-limit.js`, por um motivo concreto: o
 * limitador genérico monta a chave com `método + caminho + cliente`, e o
 * caminho desta feature carrega o id do anúncio. O limite sairia **por
 * anúncio**, e um raspador que percorre a listagem nunca bateria em nenhum —
 * ele nunca pede o mesmo anúncio duas vezes. Contra raspagem, o limite tem de
 * ser por pessoa, atravessando todos os anúncios.
 *
 * O `rateLimit.escrita()` da rota continua valendo como camada grossa contra
 * flood; esta é a camada que realmente protege a base de telefones.
 *
 * Estar no service e não num middleware também é decisão: assim a proteção
 * vale para qualquer chamador, inclusive um job futuro de exportação.
 */

/**
 * Consome uma revelação da cota da pessoa.
 *
 * `cache.incrementar` é atômico (INCR no Redis) — checar-e-depois-gravar
 * abriria a janela clássica em que dez requisições paralelas passam todas por
 * estarem abaixo do limite ao mesmo tempo.
 *
 * Cache indisponível devolve 0 e a requisição passa: um limitador que derruba
 * o site quando o Redis cai é pior que o ataque que evita — mesma decisão já
 * tomada em `middlewares/rate-limit.js`, e a coerência aqui importa mais que a
 * preferência de cada autor.
 */
async function consumirRevelacao(contexto) {
  const chave = chaves.revelacao(identidade(contexto));
  const usos = await cache.incrementar(chave, { ttl: REVELACAO.JANELA_SEGUNDOS });

  if (usos === 0) return { usos: 0, restantes: REVELACAO.MAXIMO };

  if (usos > REVELACAO.MAXIMO) {
    const segundos = await cache.ttl(chave);
    throw erros.muitasTentativas(
      'Você viu muitos contatos em pouco tempo. Aguarde para continuar.',
      { segundosRestantes: segundos > 0 ? segundos : REVELACAO.JANELA_SEGUNDOS }
    );
  }

  return { usos, restantes: Math.max(0, REVELACAO.MAXIMO - usos) };
}

/**
 * Este contato já foi contado nesta janela?
 *
 * Devolve `true` na primeira vez e `false` nas repetições. O incremento
 * acontece de qualquer forma — o TTL não é renovado a cada clique justamente
 * para que a janela termine seis horas depois do PRIMEIRO contato, e não seis
 * horas depois do último F5.
 *
 * Quando o cache está fora, devolve `true`: contar duas vezes é menos grave do
 * que perder o registro de um contato real, que é a métrica que sustenta o
 * produto.
 */
async function ehContatoNovo(contexto, { anuncioId, canal }) {
  const chave = chaves.janela(anuncioId, identidade(contexto), canal);
  const cliques = await cache.incrementar(chave, { ttl: JANELA_CONTATO_SEGUNDOS });

  if (cliques === 0) return true;
  return cliques === 1;
}

module.exports = { consumirRevelacao, ehContatoNovo };
