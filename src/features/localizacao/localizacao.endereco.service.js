'use strict';

const db = require('../../models');
const cache = require('../../cache');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const auditoria = require('../auditoria/auditoria.service');
const consentimentoService = require('../auth/auth.consentimento.service');
const territorio = require('./localizacao.territorio.service');
const { chaves } = require('./localizacao.cache');
const { ALVO, ACAO_POR_ALVO } = require('./localizacao.constants');
const { coordenadaValida } = require('../../utils/geo');

/**
 * Escrita do endereço — criação e atualização, vinculado a perfil ou anúncio.
 *
 * O endereço não tem dono próprio: quem tem dono é o perfil ou o anúncio ao
 * qual ele pertence. Por isso o escopo é verificado contra o alvo, com
 * `exigir(ctx, 'perfil.editar', { donoId })`, **depois** de carregar o registro
 * — antes disso não se sabe de quem é.
 */

/** carrega o alvo já com o que o RBAC precisa saber: quem é o dono */
async function carregarAlvo(tipo, id) {
  if (tipo === ALVO.PERFIL) {
    const perfil = await db.Perfil.findByPk(id);
    return perfil && { registro: perfil, donoId: perfil.usuario_id, entidade: 'perfil' };
  }

  const anuncio = await db.Anuncio.findByPk(id);
  return anuncio && { registro: anuncio, donoId: anuncio.usuario_id, entidade: 'anuncio' };
}

/**
 * Deriva a precisão a partir da ORIGEM, não do que o cliente mandou.
 *
 * Aceitar `precisao` do corpo deixaria qualquer um marcar como "exata" um ponto
 * que é o centro da cidade — e o comprador viajaria 40 km confiando num selo
 * que o próprio sistema emitiu.
 */
function derivarPrecisao(origem, latitude, longitude) {
  if (!coordenadaValida(latitude, longitude)) return 'aproximada';
  return origem === 'coordenada' || origem === 'mapa' ? 'exata' : 'aproximada';
}

/**
 * Cria ou atualiza o endereço do alvo.
 *
 * Tudo numa transação: gravar o endereço e não conseguir apontar o perfil para
 * ele deixaria uma linha órfã em `enderecos` e um perfil sem localização — o
 * pior dos dois mundos, e silencioso.
 */
async function salvar(dados, contexto) {
  const alvo = await carregarAlvo(dados.alvo, dados.alvoId);

  /* 404 e 403 são indistinguíveis para recurso alheio (PADRAO_MODULO §11.5):
     responder "existe, mas você não pode" transforma o endpoint em sonda de
     ids válidos */
  if (!alvo) throw erros.naoEncontrado('Registro');

  const acoes = ACAO_POR_ALVO[dados.alvo];
  exigir(contexto, acoes.editar, { donoId: alvo.donoId });

  const municipio = dados.municipioId
    ? await db.Municipio.findByPk(dados.municipioId)
    : await territorio.resolverMunicipio({ nome: dados.municipioNome, uf: dados.uf });

  const precisao = derivarPrecisao(dados.origem, dados.latitude, dados.longitude);

  const valores = {
    cep: dados.cep || null,
    logradouro: dados.logradouro || null,
    numero: dados.numero || null,
    complemento: dados.complemento || null,
    bairro: dados.bairro || null,
    referencia: dados.referencia || null,
    municipio_id: municipio ? municipio.id : null,
    municipio_nome: municipio ? municipio.nome : null,
    uf: municipio ? municipio.uf : (dados.uf || null),
    /* sem coordenada informada, a sede do município é o melhor palpite: um
       endereço sem lat/lon some do mapa e do cálculo de distância, que é
       metade do valor do produto */
    latitude: coordenadaValida(dados.latitude, dados.longitude)
      ? dados.latitude
      : municipio?.latitude ?? null,
    longitude: coordenadaValida(dados.latitude, dados.longitude)
      ? dados.longitude
      : municipio?.longitude ?? null,
    origem: dados.origem,
    precisao,
    validado_em: dados.origem === 'cep' ? new Date() : null,
  };

  const enderecoAnteriorId = alvo.registro.endereco_id;

  const endereco = await db.sequelize.transaction(async (transacao) => {
    let registro;

    if (enderecoAnteriorId) {
      registro = await db.Endereco.findByPk(enderecoAnteriorId, { transaction: transacao });
    }

    if (registro) {
      await registro.update(valores, { transaction: transacao });
    } else {
      registro = await db.Endereco.create(valores, { transaction: transacao });
    }

    const denormalizado = {
      endereco_id: registro.id,
      municipio_id: registro.municipio_id,
      uf: registro.uf,
    };

    /* anúncio guarda a coordenada duplicada para que a busca por proximidade
       filtre sem join — o índice de `latitude, longitude` vive na tabela dele */
    if (dados.alvo === ALVO.ANUNCIO) {
      denormalizado.latitude = registro.latitude;
      denormalizado.longitude = registro.longitude;
    }

    if (dados.alvo === ALVO.PERFIL && dados.exibirEnderecoExato !== undefined) {
      denormalizado.exibir_endereco_exato = dados.exibirEnderecoExato;
    }

    await alvo.registro.update(denormalizado, { transaction: transacao });

    return registro;
  });

  /* abrir o endereço exato é consentimento LGPD (art. 8º), não preferência de
     interface: precisa de linha demonstrável em `consentimentos`, com a
     origem da coleta */
  if (dados.alvo === ALVO.PERFIL && dados.exibirEnderecoExato !== undefined) {
    await consentimentoService
      .registrar(
        alvo.donoId,
        [{ tipo: 'exibir_endereco_exato', aceito: dados.exibirEnderecoExato, finalidade: 'Exibir endereço completo no anúncio' }],
        contexto,
        { origem: 'perfil' }
      )
      .catch((erro) => console.error('[localizacao] consentimento não registrado:', erro.message));
  }

  await auditoria.registrar(contexto, {
    acao: enderecoAnteriorId ? 'editar' : 'criar',
    entidade: 'endereco',
    entidadeId: endereco.id,
    depois: { alvo: dados.alvo, alvoId: dados.alvoId, origem: dados.origem, precisao },
  });

  await cache.remover(chaves.enderecoPublico(endereco.id));

  return { endereco, alvo: { tipo: dados.alvo, id: dados.alvoId, donoId: alvo.donoId } };
}

/**
 * Lê um endereço com o dono junto — o chamador precisa do dono para decidir a
 * privacidade, e buscar dono numa segunda consulta seria N+1 na listagem.
 */
async function obterComDono(enderecoId) {
  const endereco = await db.Endereco.findByPk(enderecoId);
  if (!endereco) throw erros.naoEncontrado('Endereço');

  const perfil = await db.Perfil.findOne({
    where: { endereco_id: endereco.id },
    attributes: ['id', 'usuario_id', 'tipo', 'exibir_endereco_exato'],
  });

  return { endereco, perfil };
}

module.exports = { salvar, obterComDono, carregarAlvo, derivarPrecisao };
