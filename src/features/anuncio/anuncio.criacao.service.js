'use strict';

const db = require('../../models');
const filas = require('../../filas');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const { slugify } = require('../../utils/texto');
const auditoria = require('../auditoria/auditoria.service');
const fotoService = require('./anuncio.foto.service');
const campos = require('./anuncio.campos');
const { TRABALHOS } = require('./anuncio.constants');

/**
 * Criação do anúncio — a entidade central do produto (Maturacao/05, §7.1).
 * Os três perfis passam por aqui: o produtor publica a peça que sobra, a loja
 * publica estoque, o prestador publica serviço. O que muda entre eles é o
 * `tipo`, não o fluxo.
 *
 * O anúncio nasce **rascunho** e pode nascer incompleto: quem está no campo
 * fotografando a peça precisa salvar e voltar depois. As exigências de conteúdo
 * (foto, categoria, localização) são cobradas na PUBLICAÇÃO, que é quando ele
 * passa a ocupar a vitrine.
 */

/**
 * Quem será o DONO do anúncio.
 *
 * `contexto.usuarioId` é a única origem legítima. `emNomeDeUsuarioId` só
 * atravessa para quem tem `anuncio.criar_em_nome_de` — o poder de intervenção
 * total do Admin (Maturacao/05, §2.4), que sempre deixa rastro na auditoria.
 */
async function resolverDono(contexto, dados) {
  const alvoId = dados.emNomeDeUsuarioId;
  const emNomeDe = Boolean(alvoId) && String(alvoId) !== String(contexto.usuarioId);

  if (emNomeDe) exigir(contexto, 'anuncio.criar_em_nome_de');

  const usuarioId = emNomeDe ? alvoId : contexto.usuarioId;

  const perfil = await db.Perfil.findOne({
    where: { usuario_id: usuarioId },
    attributes: ['id', 'municipio_id', 'uf'],
  });
  if (!perfil) {
    throw erros.validacao({
      emNomeDeUsuarioId: 'O usuário informado não tem perfil e não pode ter anúncios.',
    });
  }

  return {
    usuarioId,
    perfilId: perfil.id,
    emNomeDe,
    municipioIdDoPerfil: perfil.municipio_id,
    ufDoPerfil: perfil.uf,
  };
}

async function criar(contexto, dados) {
  campos.conferirPreco(dados);

  const { usuarioId, perfilId, emNomeDe, municipioIdDoPerfil, ufDoPerfil } =
    await resolverDono(contexto, dados);
  const codigo = await campos.gerarCodigo();

  /**
   * Sem cidade informada no anúncio, herda a do perfil.
   *
   * Antes, quem não preenchia manualmente nascia com `municipio_id`/`uf`
   * nulos — e ficava fora de qualquer busca por cidade, fora do "perto de
   * mim" e sem pino no mapa, mesmo o anunciante tendo cadastrado onde mora.
   * A herança só PREENCHE o que faltou: quem informa outro município no
   * anúncio (peça guardada num galpão em cidade diferente da sede) continua
   * podendo.
   */
  const dadosComLocalizacao = {
    ...dados,
    municipioId: dados.municipioId ?? municipioIdDoPerfil ?? undefined,
    uf: dados.uf ?? ufDoPerfil ?? undefined,
  };

  const anuncio = await db.sequelize.transaction(async (transacao) => {
    const criado = await db.Anuncio.create(
      {
        ...campos.paraColunas(dadosComLocalizacao),
        codigo,
        /* o código entra no slug: dois "bomba hidráulica valtra" existem, e
           sufixo numérico exigiria uma consulta a mais a cada publicação */
        slug: `${slugify(dados.titulo).slice(0, 180)}-${codigo.toLowerCase()}`,
        descricao: dados.descricao || '',
        usuario_id: usuarioId,
        perfil_id: perfilId,
        status: 'rascunho',
        criado_por_admin: emNomeDe,
        criado_por_admin_id: emNomeDe ? contexto.usuarioId : null,
      },
      { transaction: transacao }
    );

    await campos.gravarAtributos(criado.id, dados.atributos, transacao);
    await campos.gravarMaquinas(criado.id, dados.maquinas, transacao);
    await fotoService.vincular(contexto, criado, dados.fotos || [], { transacao });

    await db.AnuncioHistorico.create(
      {
        anuncio_id: criado.id,
        status_anterior: null,
        status_novo: 'rascunho',
        ator_id: contexto.usuarioId,
        ator_papel: (contexto.papeis || [])[0] || null,
        ip_hash: contexto.ipHash || null,
      },
      { transaction: transacao }
    );

    return criado;
  });

  await auditoria.registrar(contexto, {
    acao: 'criar',
    entidade: 'anuncios',
    entidadeId: anuncio.id,
    emNomeDe: emNomeDe ? usuarioId : null,
    depois: { codigo, titulo: anuncio.titulo, tipo: anuncio.tipo },
  });

  /* o texto de busca é recalculado fora do caminho da resposta: normalizar
     título + descrição + marca não pode custar milissegundos ao usuário */
  await filas.enfileirar(TRABALHOS.REINDEXAR, { anuncioId: anuncio.id });
  await campos.invalidar(anuncio.id);

  return anuncio;
}

module.exports = { criar, resolverDono };
