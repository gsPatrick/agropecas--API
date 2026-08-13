'use strict';

const { base } = require('../../cache/chaves');

/**
 * Chaves de cache da feature. Moram aqui e não em `cache/chaves.js` para que
 * dois módulos escritos em paralelo não disputem o mesmo arquivo.
 *
 * `download` guarda o bilhete do link temporário, não o arquivo: o conteúdo
 * fica no storage, e o que expira é a autorização de buscá-lo. Guardar isso no
 * Redis em vez de numa tabela é intencional — expiração é comportamento nativo
 * do Redis, e um bilhete que sobrevive a um `TRUNCATE` esquecido seria pior que
 * um que some.
 */
const chaves = {
  download: (token) => `${base()}:lgpd:download:${token}`,
  documentosVigentes: () => `${base()}:lgpd:documentos:vigentes`,
  documento: (tipo) => `${base()}:lgpd:documento:${tipo}`,
  dominio: () => `${base()}:lgpd:*`,
  dominioDocumentos: () => `${base()}:lgpd:documento*`,
};

/**
 * TTL do documento legal publicado: uma hora.
 *
 * Texto de Termos muda raríssimo, mas quando muda a publicação já invalida a
 * chave na hora. O TTL é rede de segurança para o caso de a invalidação falhar
 * numa instância — uma hora de Termos velho é aceitável; um dia não é.
 */
const TTL_DOCUMENTO = 3600;

module.exports = { chaves, TTL_DOCUMENTO };
