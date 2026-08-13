'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../../config');

/**
 * Armazenamento de arquivo.
 *
 * Driver local hoje; S3/R2/Spaces depois. A interface é a mesma, e é por isso
 * que nenhuma feature monta caminho de arquivo na mão: quando o driver mudar,
 * `url()` passa a devolver um endereço de CDN sem que o módulo de mídia saiba.
 *
 * O nome do arquivo é gerado aqui, nunca vem do cliente: nome enviado pelo
 * usuário é vetor de path traversal (`../../app.js`) e de colisão.
 */

const drivers = {
  local: {
    nome: 'local',

    async salvar(buffer, { pasta = 'geral', extensao = 'jpg' }) {
      const nome = `${crypto.randomUUID()}.${extensao.replace(/[^a-z0-9]/gi, '')}`;
      const relativo = path.join(pasta, nome);
      const absoluto = path.join(config.storage.localPath, relativo);

      await fs.mkdir(path.dirname(absoluto), { recursive: true });
      await fs.writeFile(absoluto, buffer);

      return { caminho: relativo, tamanho: buffer.length };
    },

    async remover(caminho) {
      const absoluto = path.join(config.storage.localPath, caminho);

      /* confere que o caminho resolvido continua dentro da pasta de upload:
         um registro adulterado no banco não pode virar `rm` em /etc */
      const raiz = path.resolve(config.storage.localPath);
      if (!path.resolve(absoluto).startsWith(raiz)) {
        throw new Error('Caminho de arquivo fora da área permitida.');
      }

      await fs.unlink(absoluto).catch(() => null);
    },

    url(caminho) {
      return `${config.storage.publicUrl}/${caminho.split(path.sep).join('/')}`;
    },
  },
};

const driver = () => drivers[config.storage.driver] || drivers.local;

module.exports = {
  salvar: (buffer, opcoes) => driver().salvar(buffer, opcoes),
  remover: (caminho) => driver().remover(caminho),
  url: (caminho) => (caminho ? driver().url(caminho) : null),
  motor: () => driver().nome,
};
