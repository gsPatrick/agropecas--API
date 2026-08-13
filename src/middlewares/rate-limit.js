'use strict';

const cache = require('../cache');
const { erros } = require('../utils/erros');

/**
 * Limitador de requisições.
 *
 * Conta pelo `cache`, então herda a decisão dele: com Redis, o limite é
 * **compartilhado entre todas as instâncias**; sem Redis, é por processo.
 *
 * Isso corrige a falha da versão anterior, que contava num `Map` local — com
 * duas instâncias atrás de um balanceador, o limite de 10 virava 20, e quem
 * atacasse só precisava alternar entre elas.
 *
 * Esta é a camada de ENDPOINT. O bloqueio de conta por senha errada é outra
 * coisa, vive em `auth.tentativa.service.js` e protege o alvo, não a rota.
 */

/**
 * @param opcoes.max        requisições permitidas na janela
 * @param opcoes.janelaMs   tamanho da janela
 * @param opcoes.chave      como identificar o cliente
 * @param opcoes.ignorar    condição para não contar (ex.: Admin)
 * @param opcoes.nome       diferencia limitadores empilhados na MESMA rota.
 *                          Sem ele, dois `rateLimit` na mesma rota montavam o
 *                          mesmo identificador e dividiam um contador só — o
 *                          mais restritivo era consumido pelo outro.
 * @param opcoes.porAtor    ignora o caminho na chave, fazendo a cota valer
 *                          para a PESSOA e não para a rota. É o que serve
 *                          contra raspagem: com id na URL, limitar por caminho
 *                          dá uma cota nova a cada recurso visitado.
 */
function rateLimit({
  max = 60,
  janelaMs = 60 * 1000,
  chave = (req) => req.contexto?.ipHash || req.ip,
  mensagem = 'Muitas requisições. Aguarde um instante.',
  ignorar,
  nome,
  porAtor = false,
} = {}) {
  const janelaSegundos = Math.ceil(janelaMs / 1000);

  return async (req, res, next) => {
    try {
      if (ignorar && ignorar(req)) return next();

      /* `porAtor` tira o caminho da chave; `nome` separa limitadores que
         convivem na mesma rota */
      const alvo = porAtor ? (nome || 'ator') : `${req.method}:${req.baseUrl}${req.path}`;
      const identificador = `${nome ? `${nome}:` : ''}${alvo}:${chave(req)}`;
      const chaveCache = cache.chaves.limite(identificador);

      const contagem = await cache.incrementar(chaveCache, { ttl: janelaSegundos });

      /* contagem 0 = cache indisponível. Deixa passar: um limitador que derruba
         o site quando o Redis cai é pior do que o ataque que ele evita */
      if (contagem === 0) return next();

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - contagem));

      if (contagem > max) {
        const segundos = await cache.ttl(chaveCache);
        const espera = segundos > 0 ? segundos : janelaSegundos;

        res.setHeader('Retry-After', espera);
        return next(erros.muitasTentativas(mensagem, { segundosRestantes: espera }));
      }

      next();
    } catch (erro) {
      /* falha do limitador não pode virar erro do usuário */
      console.error('[rate-limit] falhou, liberando requisição:', erro.message);
      next();
    }
  };
}

/* perfis prontos — senha e código é onde a força bruta compensa */
rateLimit.autenticacao = () =>
  rateLimit({
    nome: 'auth',
    max: 10,
    janelaMs: 15 * 60 * 1000,
    mensagem: 'Muitas tentativas. Aguarde alguns minutos.',
  });

rateLimit.codigo = () =>
  rateLimit({
    nome: 'codigo',
    max: 5,
    janelaMs: 60 * 60 * 1000,
    mensagem: 'Muitos códigos solicitados. Tente novamente mais tarde.',
  });

rateLimit.escrita = () => rateLimit({ nome: 'escrita', max: 30, janelaMs: 60 * 1000 });

/**
 * Cota por PESSOA, válida em todas as rotas do grupo.
 *
 * É o formato certo para dado sensível com id na URL — revelar telefone,
 * abrir ficha de usuário: limitar por caminho daria uma cota nova a cada
 * anúncio, e raspar a base inteira continuaria trivial.
 */
rateLimit.porAtor = (nome, { max, janelaMs, mensagem }) =>
  rateLimit({ nome, porAtor: true, max, janelaMs, mensagem });

/** leitura pública: generoso, mas ainda barra raspagem de catálogo */
rateLimit.leitura = () => rateLimit({ nome: 'leitura', max: 300, janelaMs: 60 * 1000 });

module.exports = rateLimit;
