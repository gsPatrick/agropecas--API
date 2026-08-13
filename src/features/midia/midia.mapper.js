'use strict';

const { STATUS, ROTULOS_VARIANTE } = require('./midia.constants');

/**
 * Model → JSON. Lista branca, como manda §6 do padrão.
 *
 * Fora da resposta ficam `path` e `driver`: são detalhe de infraestrutura, e
 * publicá-los ensina a estrutura do storage a qualquer cliente. O que o front
 * precisa é `url` — quando o driver virar S3, a URL muda e nenhuma tela sabe.
 *
 * `hash_conteudo` também não sai: com ele, alguém pode conferir se uma imagem
 * que possui já está na plataforma, o que é uma consulta que ninguém pediu.
 */

/**
 * O status é DERIVADO, não armazenado: a tabela `arquivos` não tem coluna de
 * estado e migration não é deste módulo. "Tem variante" é a mesma informação —
 * e tem a vantagem de não poder divergir da realidade do disco, que é o que
 * acontece com toda coluna de status que alguém esquece de atualizar.
 */
const statusDe = (variantes = {}) =>
  ROTULOS_VARIANTE.every((rotulo) => variantes[rotulo]) ? STATUS.PRONTO : STATUS.PROCESSANDO;

const urlsDasVariantes = (variantes = {}) =>
  ROTULOS_VARIANTE.reduce((acumulado, rotulo) => {
    acumulado[rotulo] = variantes[rotulo] ? variantes[rotulo].url : null;
    return acumulado;
  }, {});

const arquivo = (registro, variantes = {}) => {
  if (!registro) return null;

  return {
    id: registro.id,
    /* enquanto as variantes não existem, o front mostra o original: melhor uma
       imagem pesada por alguns segundos do que um espaço vazio no anúncio */
    url: registro.url,
    mime: registro.mime,
    tamanhoBytes: registro.tamanho_bytes,
    nomeOriginal: registro.nome_original,
    status: statusDe(variantes),
    variantes: urlsDasVariantes(variantes),
    referencia: registro.referencia_tipo
      ? { tipo: registro.referencia_tipo, id: registro.referencia_id }
      : null,
    /* a data de descarte aparece porque é acionável: é o aviso de que aquele
       upload será apagado se não for vinculado a um anúncio */
    descartarEm: registro.descartar_em || null,
    criadoEm: registro.criado_em,
  };
};

const lista = (itens = []) => itens.map((item) => arquivo(item.arquivo, item.variantes));

module.exports = { arquivo, lista, statusDe, urlsDasVariantes };
