'use strict';

const db = require('../../models');
const filas = require('../../filas');
const { erros } = require('../../utils/erros');
const auditoria = require('../auditoria/auditoria.service');
const acesso = require('./anuncio.acesso.service');
const politica = require('./anuncio.politica.service');
const fotoService = require('./anuncio.foto.service');
const historico = require('./anuncio.historico.service');
const campos = require('./anuncio.campos');
const { TRANSICOES } = require('./anuncio.constants');

/**
 * Entrada no ar: publicar, pausar, renovar.
 *
 * O estado é sempre resultado de uma AÇÃO nomeada, nunca de um `PATCH status`.
 * A diferença não é estética: cada ação tem pré-condição, permissão e registro
 * próprios, e um campo livre de status apagaria os três de uma vez.
 */

function garantirTransicao(acao, anuncio) {
  const regra = TRANSICOES[acao];
  if (!regra.de.includes(anuncio.status)) {
    throw erros.conflito(`Não é possível ${acao} um anúncio com status "${anuncio.status}".`, {
      code: 'TRANSICAO_INVALIDA',
      de: anuncio.status,
    });
  }
  return regra.para;
}

/**
 * O que a vitrine exige.
 * Rascunho pode estar pela metade; publicado, não — anúncio sem foto e sem
 * cidade ocupa espaço na busca e não gera contato nenhum.
 */
async function conferirCompletude(anuncio) {
  const pendencias = {};

  if (!anuncio.titulo || anuncio.titulo.trim().length < 5) pendencias.titulo = 'Informe o título.';
  if (!anuncio.categoria_id) pendencias.categoriaId = 'Escolha uma categoria.';
  if (!anuncio.municipio_id && !anuncio.endereco_id && !(anuncio.latitude && anuncio.longitude)) {
    pendencias.municipioId = 'Informe a localização do anúncio.';
  }
  if ((await fotoService.contar(anuncio.id)) === 0) {
    pendencias.fotos = 'Adicione ao menos uma foto.';
  }

  if (Object.keys(pendencias).length) throw erros.validacao(pendencias);
}

async function publicar(contexto, id) {
  const anuncio = await acesso.paraAcao(contexto, id, 'anuncio.publicar');
  const para = garantirTransicao('publicar', anuncio);

  await conferirCompletude(anuncio);
  /* a quota é do DONO do anúncio, não de quem clicou: o Admin publicando em
     nome de terceiro não empresta o próprio limite */
  await politica.garantirLimiteDePublicacao(anuncio.usuario_id, { anuncioId: anuncio.id });

  const de = anuncio.status;
  const agora = new Date();
  const expiraEm = await politica.calcularExpiracao(agora);

  /* moderação prévia é configurável e hoje está desligada: o anúncio entra no
     ar direto e a intervenção do Admin é a posteriori (Maturacao/05, §7.4) */
  const previa = (await politica.moderacaoPrevia()) === true;

  await db.sequelize.transaction(async (transacao) => {
    await anuncio.update(
      {
        status: para,
        publicado_em: anuncio.publicado_em || agora,
        expira_em: expiraEm,
        moderacao_status: previa ? 'em_analise' : anuncio.moderacao_status,
      },
      { transaction: transacao }
    );
    await historico.registrar(anuncio, { de, para, contexto, transacao });
    await historico.ajustarContadorDoPerfil(anuncio, { de, para }, transacao);
  });

  const alheio = String(anuncio.usuario_id) !== String(contexto.usuarioId);

  await auditoria.registrar(contexto, {
    acao: 'publicar',
    entidade: 'anuncios',
    entidadeId: anuncio.id,
    emNomeDe: alheio ? anuncio.usuario_id : null,
    depois: { status: para, expira_em: expiraEm },
  });

  /* o titular precisa saber que agiram por ele — poder amplo com aviso é
     intervenção; sem aviso, é surpresa */
  if (alheio) {
    await filas.enfileirar('notificacao.criar', {
      usuarioId: anuncio.usuario_id,
      tipo: 'sistema',
      titulo: 'Seu anúncio foi publicado',
      mensagem: `O anúncio "${anuncio.titulo}" foi publicado pela administração.`,
      dados: { anuncioId: anuncio.id },
      entidade: 'anuncios',
      entidadeId: anuncio.id,
      canais: ['sistema'],
    });
  }

  await campos.invalidar(anuncio.id);
  return anuncio;
}

/** tira da vitrine sem perder nada: é o "vendi, mas posso ter de novo" */
async function pausar(contexto, id, { motivo } = {}) {
  const anuncio = await acesso.paraAcao(contexto, id, 'anuncio.pausar');
  const para = garantirTransicao('pausar', anuncio);
  const de = anuncio.status;

  await db.sequelize.transaction(async (transacao) => {
    await anuncio.update({ status: para }, { transaction: transacao });
    await historico.registrar(anuncio, { de, para, contexto, motivo, transacao });
  });

  await campos.invalidar(anuncio.id);
  return anuncio;
}

/** estende a validade — expirado volta ao ar sem precisar recriar nada */
async function renovar(contexto, id) {
  const anuncio = await acesso.paraAcao(contexto, id, 'anuncio.renovar');
  const para = garantirTransicao('renovar', anuncio);
  const de = anuncio.status;

  await conferirCompletude(anuncio);
  await politica.garantirLimiteDePublicacao(anuncio.usuario_id, { anuncioId: anuncio.id });

  const agora = new Date();
  const expiraEm = await politica.calcularExpiracao(agora);

  await db.sequelize.transaction(async (transacao) => {
    await anuncio.update(
      {
        status: para,
        expira_em: expiraEm,
        renovado_em: agora,
        total_renovacoes: (anuncio.total_renovacoes || 0) + 1,
        /* renovar reabre a posição na vitrine: sem mexer em `publicado_em` o
           anúncio renovado voltaria enterrado no fim da lista e a renovação
           não entregaria o que promete */
        publicado_em: agora,
      },
      { transaction: transacao }
    );
    await historico.registrar(anuncio, { de, para, contexto, motivo: 'renovacao', transacao });
    await historico.ajustarContadorDoPerfil(anuncio, { de, para }, transacao);
  });

  await campos.invalidar(anuncio.id);
  return anuncio;
}

module.exports = { publicar, pausar, renovar, conferirCompletude, garantirTransicao };
