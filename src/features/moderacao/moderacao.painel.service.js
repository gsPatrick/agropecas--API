'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const { chaves } = require('./moderacao.cache');
const { exigirEscopoTotal } = require('./moderacao.comum');
const { FILA_STATUS, TTL_PAINEL } = require('./moderacao.constants');

/**
 * Painel de pendências: os números que abrem a tela de moderação.
 *
 * São contagens, e contagem é a consulta mais fácil de transformar em problema:
 * a tela é aberta a cada troca de aba e a cada F5, e sem cache isso vira
 * `COUNT(*)` em três tabelas grandes o dia inteiro.
 *
 * Duas decisões:
 *   1. **Cache curto (30s), invalidado nas ações.** O TTL é rede de segurança;
 *      quem aprova um anúncio já derruba a chave em `moderacao.comum.js`.
 *   2. **As contagens rodam em paralelo**, não em sequência. São independentes,
 *      e enfileirá-las triplicaria a latência do painel sem nenhum ganho.
 *
 * O cache guarda objeto simples, nunca instância do Sequelize (PADRÃO_MODULO §7).
 */
async function contadores(contexto) {
  exigirEscopoTotal(contexto, 'denuncia.ler');

  return cache.lembrar(
    chaves.painel(),
    async () => {
      const [denunciasAbertas, denunciasEmAnalise, anunciosNaFila, anunciosOcultos, suspensos, banidos] =
        await Promise.all([
          db.Denuncia.count({ where: { status: 'aberta' } }),
          db.Denuncia.count({ where: { status: 'em_analise' } }),
          db.Anuncio.count({
            where: {
              moderacao_status: { [Op.in]: FILA_STATUS },
              status: { [Op.ne]: 'removido' },
            },
          }),
          db.Anuncio.count({ where: { status: 'oculto' } }),
          db.Usuario.count({ where: { status: 'suspenso' } }),
          db.Usuario.count({ where: { status: 'banido' } }),
        ]);

      return {
        denunciasAbertas,
        denunciasEmAnalise,
        anunciosNaFila,
        anunciosOcultos,
        usuariosSuspensos: suspensos,
        usuariosBanidos: banidos,
        /* o front usa isto para o badge do menu: um número só, que é o que
           cabe no ícone */
        totalPendencias: denunciasAbertas + denunciasEmAnalise + anunciosNaFila,
        calculadoEm: new Date().toISOString(),
      };
    },
    { ttl: TTL_PAINEL }
  );
}

/** força o recálculo — usado pelas ações e pela tela ao puxar para atualizar */
const invalidar = () => cache.remover(chaves.painel());

module.exports = { contadores, invalidar };
