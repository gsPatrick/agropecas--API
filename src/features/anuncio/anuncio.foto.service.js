'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const politica = require('./anuncio.politica.service');

/**
 * Fotos do anúncio: vincular, desvincular, reordenar, definir capa.
 *
 * **O upload não é daqui.** Quem recebe o byte, valida magic bytes e gera
 * miniatura é o módulo `midia`, que grava em `arquivos`. Este service trabalha
 * com um `Arquivo` que já existe, referenciado por id — a fronteira mantém o
 * anúncio ignorante sobre storage e o storage ignorante sobre negócio.
 *
 * A regra de segurança central: **o arquivo precisa ser de quem está anexando**.
 * Sem esse teste, qualquer usuário anexaria ao próprio anúncio a foto de um
 * arquivo alheio só citando o UUID — inclusive documento que outra pessoa subiu
 * em outro fluxo.
 */

/** ids que o solicitante pode legitimamente anexar a este anúncio */
function donosAceitos(contexto, anuncio) {
  /* o Admin publicando em nome de terceiro pode usar arquivo que ele mesmo
     subiu; o dono do anúncio, os dele. Ninguém usa arquivo de um terceiro */
  return [anuncio.usuario_id, contexto?.usuarioId].filter(Boolean);
}

async function conferirArquivos(contexto, anuncio, ids, transacao) {
  const arquivos = await db.Arquivo.findAll({
    where: { id: { [Op.in]: ids }, usuario_id: { [Op.in]: donosAceitos(contexto, anuncio) } },
    transaction: transacao,
  });

  if (arquivos.length !== ids.length) {
    /* mensagem única para "não existe" e "não é seu": distinguir os dois casos
       transformaria o endpoint em oráculo de quais UUIDs de arquivo existem */
    throw erros.validacao({ fotos: 'Alguma das imagens não existe ou não pertence a você.' });
  }

  /* devolve na ordem em que o usuário pediu — é ela que vira `ordem` */
  return ids.map((id) => arquivos.find((arquivo) => String(arquivo.id) === String(id)));
}

/**
 * Anexa arquivos ao anúncio.
 * A primeira foto de um anúncio sem capa vira capa sozinha: exigir um segundo
 * clique para algo com resposta óbvia só gera anúncio sem imagem na vitrine.
 */
async function vincular(contexto, anuncio, arquivoIds = [], { transacao } = {}) {
  if (!arquivoIds.length) return [];

  exigir(contexto, 'anuncio_foto.enviar', { donoId: anuncio.usuario_id });

  const existentes = await db.AnuncioFoto.count({
    where: { anuncio_id: anuncio.id },
    transaction: transacao,
  });

  const teto = await politica.limiteDeFotos(anuncio.usuario_id);
  if (existentes + arquivoIds.length > teto) {
    throw erros.validacao({ fotos: `Este anúncio aceita no máximo ${teto} foto(s).` });
  }

  const arquivos = await conferirArquivos(contexto, anuncio, arquivoIds, transacao);

  const linhas = arquivos.map((arquivo, indice) => ({
    anuncio_id: anuncio.id,
    path: arquivo.path,
    url: arquivo.url,
    url_thumb: arquivo.url,
    nome_original: arquivo.nome_original,
    mime: arquivo.mime,
    tamanho_bytes: arquivo.tamanho_bytes,
    ordem: existentes + indice,
    principal: existentes === 0 && indice === 0,
  }));

  const criadas = await db.AnuncioFoto.bulkCreate(linhas, { transaction: transacao });

  /* marca o arquivo como usado: sem isto a faxina do worker apagaria do bucket
     uma imagem que está na vitrine */
  await db.Arquivo.update(
    { referencia_tipo: 'anuncios', referencia_id: anuncio.id, descartar_em: null },
    { where: { id: { [Op.in]: arquivoIds } }, transaction: transacao }
  );

  return criadas;
}

/** desvincula e devolve o arquivo à faxina — a imagem some da vitrine na hora */
async function remover(contexto, anuncio, fotoId) {
  exigir(contexto, 'anuncio_foto.remover', { donoId: anuncio.usuario_id });

  const foto = await db.AnuncioFoto.findOne({ where: { id: fotoId, anuncio_id: anuncio.id } });
  if (!foto) throw erros.naoEncontrado('Foto');

  await db.sequelize.transaction(async (transacao) => {
    await foto.destroy({ transaction: transacao });

    /* órfão marcado para descarte em 7 dias, não apagado agora: quem removeu
       por engano ainda tem uma semana para o suporte recuperar */
    await db.Arquivo.update(
      { descartar_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      { where: { path: foto.path, referencia_id: anuncio.id }, transaction: transacao }
    );

    if (foto.principal) {
      const proxima = await db.AnuncioFoto.findOne({
        where: { anuncio_id: anuncio.id },
        order: [['ordem', 'ASC']],
        transaction: transacao,
      });
      if (proxima) await proxima.update({ principal: true }, { transaction: transacao });
    }
  });

  return { removida: true };
}

/**
 * Reordena pela lista recebida.
 * Um `UPDATE` por foto dentro de uma transação e não um laço de `save()` solto:
 * ordem pela metade é galeria embaralhada na vitrine.
 */
async function reordenar(contexto, anuncio, ordemIds = []) {
  exigir(contexto, 'anuncio_foto.enviar', { donoId: anuncio.usuario_id });

  const fotos = await db.AnuncioFoto.findAll({
    where: { anuncio_id: anuncio.id },
    attributes: ['id'],
  });

  const conhecidos = new Set(fotos.map((foto) => String(foto.id)));
  if (ordemIds.length !== fotos.length || ordemIds.some((id) => !conhecidos.has(String(id)))) {
    throw erros.validacao({ ordem: 'A lista precisa conter exatamente as fotos deste anúncio.' });
  }

  await db.sequelize.transaction(async (transacao) =>
    Promise.all(
      ordemIds.map((id, indice) =>
        db.AnuncioFoto.update(
          { ordem: indice },
          { where: { id, anuncio_id: anuncio.id }, transaction: transacao }
        )
      )
    )
  );

  return listar(anuncio.id);
}

/** capa é exclusiva: definir uma tira a marca das outras na mesma transação */
async function definirCapa(contexto, anuncio, fotoId) {
  exigir(contexto, 'anuncio_foto.enviar', { donoId: anuncio.usuario_id });

  const foto = await db.AnuncioFoto.findOne({ where: { id: fotoId, anuncio_id: anuncio.id } });
  if (!foto) throw erros.naoEncontrado('Foto');

  await db.sequelize.transaction(async (transacao) => {
    await db.AnuncioFoto.update(
      { principal: false },
      { where: { anuncio_id: anuncio.id }, transaction: transacao }
    );
    await foto.update({ principal: true }, { transaction: transacao });
  });

  return listar(anuncio.id);
}

const listar = (anuncioId) =>
  db.AnuncioFoto.findAll({ where: { anuncio_id: anuncioId }, order: [['ordem', 'ASC']] });

const contar = (anuncioId, transacao) =>
  db.AnuncioFoto.count({
    where: { anuncio_id: anuncioId, bloqueada: false },
    transaction: transacao,
  });

module.exports = { vincular, remover, reordenar, definirCapa, listar, contar };
