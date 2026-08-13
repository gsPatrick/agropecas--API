'use strict';

const fs = require('fs/promises');
const path = require('path');
const config = require('../../config');
const storage = require('../../providers/storage');
const { erros } = require('../../utils/erros');

/**
 * Ponte entre o módulo e o `providers/storage`.
 *
 * Gravar, apagar e montar URL já são do provider e é ele quem faz — este
 * arquivo só reexporta para que nenhum service do módulo importe caminho de
 * disco por conta própria.
 *
 * A exceção é `ler`: o provider hoje não expõe leitura, e o job precisa dos
 * bytes do original para gerar as variantes. Enquanto isso não existir lá, a
 * leitura mora AQUI e em nenhum outro lugar — assim, quando o driver S3
 * entrar, há um ponto único para trocar. Está reportado ao orquestrador.
 */

const RAIZ = () => path.resolve(config.storage.localPath);

/**
 * Resolve um caminho relativo do banco para o disco, recusando qualquer coisa
 * que escape da pasta de upload.
 *
 * O `path` vem do banco, não do cliente — mas uma injeção em outro módulo, um
 * dump restaurado errado ou um bug de migração podem colocar `../../` ali, e
 * o resultado seria `fs` operando em `/etc`. Confiança em dado do próprio
 * banco é o que transforma uma falha pequena em incidente.
 */
function absoluto(relativo) {
  if (!relativo || typeof relativo !== 'string') {
    throw erros.interno('Caminho de arquivo ausente.');
  }

  const resolvido = path.resolve(RAIZ(), relativo);
  const raiz = RAIZ();

  if (resolvido !== raiz && !resolvido.startsWith(raiz + path.sep)) {
    throw erros.interno('Caminho de arquivo fora da área permitida.');
  }
  return resolvido;
}

/** bytes do arquivo; `null` quando ele já não existe no disco */
async function ler(relativo) {
  try {
    return await fs.readFile(absoluto(relativo));
  } catch (erro) {
    if (erro.code === 'ENOENT') return null;
    throw erro;
  }
}

const salvar = (buffer, opcoes) => storage.salvar(buffer, opcoes);

/* remoção nunca lança: apagar arquivo que já não existe é o estado desejado,
   e uma faxina que para no primeiro ENOENT nunca termina a lista */
const remover = (relativo) => storage.remover(relativo).catch(() => null);

const url = (relativo) => storage.url(relativo);

module.exports = { ler, salvar, remover, url, absoluto };
