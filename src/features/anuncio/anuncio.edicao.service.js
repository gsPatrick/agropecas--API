'use strict';

const db = require('../../models');
const filas = require('../../filas');
const auditoria = require('../auditoria/auditoria.service');
const acesso = require('./anuncio.acesso.service');
const fotoService = require('./anuncio.foto.service');
const campos = require('./anuncio.campos');
const { TRABALHOS } = require('./anuncio.constants');

/**
 * Edição do anúncio.
 *
 * Separada da criação porque as duas têm regras diferentes onde importa: criar
 * decide o dono e o código; editar só pode mexer no conteúdo, e o dono é o que
 * já está gravado. Misturar as duas num "salvar" único é como um `usuario_id`
 * editável entra no sistema.
 *
 * O escopo é conferido em `acesso.paraAcao`: dono mexe no seu, quem tem
 * `anuncio.editar.todos` mexe em qualquer um, e um terceiro sequer descobre que
 * o anúncio existe.
 */
async function editar(contexto, id, dados) {
  const anuncio = await acesso.paraAcao(contexto, id, 'anuncio.editar');

  /* só confere o preço quando um dos dois campos foi mexido: exigir na edição
     de título obrigaria o front a reenviar o anúncio inteiro */
  if (dados.precoCentavos !== undefined || dados.precoACombinar !== undefined) {
    campos.conferirPreco({
      precoCentavos: dados.precoCentavos !== undefined ? dados.precoCentavos : anuncio.preco_centavos,
      precoACombinar:
        dados.precoACombinar !== undefined ? dados.precoACombinar : anuncio.preco_a_combinar,
    });
  }

  const colunas = campos.paraColunas(dados);

  /* o "antes" é capturado campo a campo, e não o registro inteiro: a trilha
     precisa mostrar o que mudou, não repetir o anúncio duas vezes por edição */
  const antes = {};
  Object.keys(colunas).forEach((coluna) => {
    antes[coluna] = anuncio[coluna];
  });

  await db.sequelize.transaction(async (transacao) => {
    await anuncio.update(colunas, { transaction: transacao });
    await campos.gravarAtributos(anuncio.id, dados.atributos, transacao);
    await campos.gravarMaquinas(anuncio.id, dados.maquinas, transacao);

    if (dados.fotos?.length) {
      await fotoService.vincular(contexto, anuncio, dados.fotos, { transacao });
    }

    await db.AnuncioHistorico.create(
      {
        anuncio_id: anuncio.id,
        status_anterior: anuncio.status,
        status_novo: anuncio.status,
        ator_id: contexto.usuarioId,
        ator_papel: (contexto.papeis || [])[0] || null,
        alteracoes: { antes, depois: colunas },
        ip_hash: contexto.ipHash || null,
      },
      { transaction: transacao }
    );
  });

  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: 'anuncios',
    entidadeId: anuncio.id,
    /* edição sobre anúncio alheio é sempre intervenção do Admin — a auditoria
       precisa guardar em nome de quem ele agiu */
    emNomeDe: String(anuncio.usuario_id) !== String(contexto.usuarioId) ? anuncio.usuario_id : null,
    antes,
    depois: colunas,
  });

  await filas.enfileirar(TRABALHOS.REINDEXAR, { anuncioId: anuncio.id });
  await campos.invalidar(anuncio.id);

  return anuncio;
}

module.exports = { editar };
