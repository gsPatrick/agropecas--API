'use strict';

const db = require('../../models');
const cache = require('../../cache');
const chavesCache = require('./catalogo.cache');
const { TTL_CATALOGO } = require('./catalogo.constants');
const mapper = require('./catalogo.mapper');

/**
 * Culturas — o que o produtor planta ou cria, para a tela "Minha propriedade".
 *
 * Ao contrário de serviço, esta lista JÁ nasceu semeada
 * (`migrations/20260815000100-perfil-culturas-e-maquinario.js`): é vocabulário
 * fechado desde o início, não uma decisão pendente da cliente. Por isso não há
 * escrita aqui — só leitura. Criar/editar cultura é tarefa rara o bastante
 * para caber numa migração nova, não numa tela de Admin.
 */
async function listar() {
  return cache.lembrar(
    chavesCache.chaves.culturas(),
    async () => {
      const linhas = await db.Cultura.findAll({
        where: { ativo: true },
        attributes: ['id', 'nome', 'slug', 'icone', 'grupo', 'ordem'],
        order: [
          ['ordem', 'ASC'],
          ['nome', 'ASC'],
        ],
        raw: true,
      });

      return linhas.map(mapper.culturaCatalogo);
    },
    { ttl: TTL_CATALOGO }
  );
}

module.exports = { listar };
