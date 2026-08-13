'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const mapper = require('./anuncio.mapper');
const { chaves } = require('./anuncio.cache');
const { INCLUDES_LISTA } = require('./anuncio.relacoes');
const { CAMPOS_LISTA, TTL } = require('./anuncio.constants');

/**
 * "Anúncios parecidos" do carrossel do detalhe.
 *
 * Parecido é, nesta ordem: a mesma categoria ou a mesma máquina compatível.
 * Máquina entra porque quem procura bomba de um John Deere 6110 aceita a de
 * outro anunciante para o mesmo modelo, mesmo em categoria diferente.
 */
async function parecidos(id, { limite = 8 } = {}) {
  return cache.lembrar(
    chaves.parecidos(id),
    async () => {
      const base = await db.Anuncio.findByPk(id, {
        attributes: ['id', 'categoria_id', 'marca_id', 'tipo'],
        include: [
          { model: db.Maquina, as: 'maquinasCompativeis', attributes: ['id'], through: { attributes: [] } },
        ],
      });
      if (!base) return [];

      const maquinaIds = (base.maquinasCompativeis || []).map((maquina) => maquina.id);

      const alternativas = [];
      if (base.categoria_id) alternativas.push({ categoria_id: base.categoria_id });
      if (base.marca_id) alternativas.push({ marca_id: base.marca_id });
      if (maquinaIds.length) {
        alternativas.push({
          id: {
            [Op.in]: db.sequelize.literal(
              `(SELECT anuncio_id FROM anuncio_maquinas WHERE maquina_id IN (${maquinaIds
                .map((maquinaId) => db.sequelize.escape(maquinaId))
                .join(',')}))`
            ),
          },
        });
      }
      if (!alternativas.length) return [];

      const registros = await db.Anuncio.findAll({
        where: {
          status: 'publicado',
          id: { [Op.ne]: id },
          tipo: base.tipo,
          [Op.or]: alternativas,
        },
        attributes: CAMPOS_LISTA,
        include: INCLUDES_LISTA(),
        order: [['publicado_em', 'DESC']],
        limit: limite,
      });

      return registros.map(mapper.resumo);
    },
    { ttl: TTL.PARECIDOS }
  );
}

module.exports = { parecidos };
