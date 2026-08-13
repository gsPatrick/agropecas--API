'use strict';

const db = require('../../models');
const consultaService = require('./plano.consulta.service');
const { balde } = require('./plano.comum');

/**
 * Painel de consumo — a tela "meu uso".
 *
 * Fica separado de `plano.limite.service.js` porque são dois assuntos com
 * exigências opostas: lá o objetivo é decidir "pode?" no caminho de toda
 * publicação, e cada consulta evitada conta; aqui o objetivo é MOSTRAR o
 * número, e vale gastar uma consulta a mais para trazer todos os contadores.
 */

/**
 * Um item por limite do plano, com o consumo de cada um.
 *
 * Busca todos os contadores numa consulta só e cruza em memória. A alternativa
 * — um `findOne` por limite dentro do laço — é o N+1 que a revisão rejeita, e
 * apareceria assim que um plano tivesse dez quotas.
 */
async function panorama(usuarioId) {
  const efetivo = await consultaService.planoEfetivo(usuarioId);
  const definicoes = Object.values(efetivo.limites);

  if (!definicoes.length) return { plano: efetivo, itens: [] };

  const registros = await db.UsoMedido.findAll({
    where: { usuario_id: usuarioId, chave: definicoes.map((limite) => limite.chave) },
    attributes: ['chave', 'periodo_inicio', 'quantidade'],
  });

  const porChave = new Map(
    registros.map((registro) => [`${registro.chave}:${registro.periodo_inicio}`, Number(registro.quantidade)])
  );

  const itens = definicoes.map((limite) => {
    const janela = balde(limite.periodo);
    const usado = porChave.get(`${limite.chave}:${janela.inicio}`) || 0;
    const ilimitado = limite.valor === null || limite.valor === undefined;

    return {
      chave: limite.chave,
      descricao: limite.descricao,
      periodo: limite.periodo,
      periodoInicio: janela.inicio,
      periodoFim: janela.fim,
      /* `null` e não `Infinity`: o mapper devolve isso ao front, e JSON não
         tem Infinity — viraria `null` de qualquer jeito, mas por acidente */
      limite: ilimitado ? null : Number(limite.valor),
      ilimitado,
      usado,
      restante: ilimitado ? null : Math.max(0, Number(limite.valor) - usado),
    };
  });

  return { plano: efetivo, itens };
}

module.exports = { panorama };
