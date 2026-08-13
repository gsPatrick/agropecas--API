'use strict';

const db = require('../../models');
const cache = require('../../cache');
const { chaves } = require('./relatorio.cache');
const { numero } = require('./relatorio.comum');
const { TTL } = require('./relatorio.constants');
const { PERFIL_TIPO } = require('../../models/constantes');

/**
 * Os quatro números da home — o único relatório público da plataforma.
 *
 * Existe separado do painel porque o contrato é o oposto do dele. O painel é
 * inteligência de mercado e por isso pede login e permissão; estes quatro
 * números são MARKETING: aparecem na página de entrada, para quem ainda não
 * tem conta, e é justamente aí que precisam ser verdade.
 *
 * ## O que este arquivo pode devolver
 *
 * **Só contagem global.** Nada de lista, nada de recorte, nada de nome. A
 * regra prática: se um número aqui pudesse ficar pequeno o bastante para
 * apontar para uma pessoa ("2 prestadores em Sorriso"), ele não pertence a
 * esta rota. Por isso não há filtro nenhum na assinatura — não é esquecimento,
 * é o que impede que a rota pública vire um contador de concorrência por
 * cidade para quem souber montar a query.
 *
 * Contagem de plataforma inteira ("48 lojas cadastradas") não fala de
 * indivíduo e por isso não passa pelo piso de agregação de
 * `relatorio.comum.suprimirPequenos`, que serve para o caso oposto.
 *
 * ## Custo
 *
 * Duas consultas, não quatro: os três tipos de perfil saem de um único
 * `COUNT ... GROUP BY tipo`, que bate no índice de `perfis.tipo`. Somado ao
 * cache de 10 minutos (ver `TTL.PUBLICO`), a home mais visitada do produto
 * custa ao banco algumas dezenas de consultas por dia.
 */

/** os três tipos de perfil em UMA consulta agregada */
async function perfisPorTipo() {
  /* `paranoid: true` no model já exclui perfil removido — não é preciso (nem
     correto) repetir o filtro aqui */
  const linhas = await db.Perfil.count({ group: ['tipo'], col: 'id' });

  /* começa em zero para TODO tipo conhecido: o GROUP BY simplesmente não
     devolve linha para o tipo sem nenhum cadastro, e sem esta base a home
     receberia `undefined` no lugar de `0` no dia do lançamento */
  const base = Object.fromEntries(PERFIL_TIPO.map((tipo) => [tipo, 0]));

  linhas.forEach((linha) => {
    base[linha.tipo] = numero(linha.count);
  });

  return base;
}

/**
 * Números públicos da plataforma.
 *
 * @returns {Promise<{produtores:number, lojas:number, prestadores:number, anunciosAtivos:number}>}
 */
async function publico() {
  return cache.lembrar(
    chaves.publico(),
    async () => {
      const [porTipo, anunciosAtivos] = await Promise.all([
        perfisPorTipo(),
        /* "ativo" para o visitante é o que ele consegue abrir: `publicado`.
           Rascunho, pausado e expirado existem no banco mas não são oferta —
           contá-los seria inflar o número que a home usa como promessa */
        db.Anuncio.count({ where: { status: 'publicado' } }),
      ]);

      return {
        produtores: porTipo.produtor,
        lojas: porTipo.loja,
        prestadores: porTipo.prestador,
        anunciosAtivos,
      };
    },
    /* `cachearVazio` fica no padrão (false), mas aqui o valor nunca é nulo:
       um objeto de zeros é resposta legítima e é cacheado normalmente */
    { ttl: TTL.PUBLICO }
  );
}

module.exports = { publico };
