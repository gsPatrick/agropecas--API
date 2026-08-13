'use strict';

const db = require('../../models');
const { distanciaKm, caixaDeRaio, coordenadaValida } = require('../../utils/geo');
const privacidade = require('./localizacao.privacidade.service');
const { ALVO, RAIO_BUSCA_PADRAO_KM, RAIO_BUSCA_MAX_KM } = require('./localizacao.constants');
const { erros } = require('../../utils/erros');

/**
 * Distância entre o visitante e os anúncios/perfis.
 *
 * Maturacao/05 §9.2: a distância é calculada **só quando o usuário pede** —
 * pedir a geolocalização no carregamento da página é invasivo e a maioria nega
 * por reflexo, e aí o recurso fica quebrado para todo mundo.
 *
 * O cálculo é feito no servidor e não no navegador porque a coordenada do
 * anúncio pode ser ofuscada: mandar a coordenada real para o front calcular
 * seria contornar a própria privacidade pelo caminho mais óbvio.
 */

/** uma consulta em lote, nunca `findByPk` dentro de laço (PADRAO_MODULO §10.1) */
async function carregarAlvos(tipo, ids) {
  if (tipo === ALVO.ANUNCIO) {
    return db.Anuncio.findAll({
      where: { id: ids },
      attributes: ['id', 'usuario_id', 'perfil_id', 'latitude', 'longitude', 'municipio_id', 'uf'],
      include: [
        {
          model: db.Perfil,
          as: 'perfil',
          attributes: ['id', 'usuario_id', 'exibir_endereco_exato'],
        },
      ],
    });
  }

  return db.Perfil.findAll({
    where: { id: ids },
    attributes: ['id', 'usuario_id', 'exibir_endereco_exato', 'endereco_id', 'municipio_id', 'uf'],
    include: [
      { model: db.Endereco, as: 'endereco', attributes: ['id', 'latitude', 'longitude'] },
    ],
  });
}

const coordenadaDoAlvo = (tipo, registro) =>
  tipo === ALVO.ANUNCIO
    ? { latitude: registro.latitude, longitude: registro.longitude }
    : {
        latitude: registro.endereco?.latitude ?? null,
        longitude: registro.endereco?.longitude ?? null,
      };

const consentimentoDoAlvo = (tipo, registro) =>
  tipo === ALVO.ANUNCIO
    ? {
        donoId: registro.usuario_id,
        exibirEnderecoExato: registro.perfil?.exibir_endereco_exato,
      }
    : { donoId: registro.usuario_id, exibirEnderecoExato: registro.exibir_endereco_exato };

/**
 * Distância da origem até cada alvo.
 *
 * A distância divulgada respeita a mesma regra do endereço: alvo com
 * localização aproximada devolve distância em faixa de 5 km. Distância exata a
 * partir de origens diferentes recuperaria o ponto real por trilateração, e o
 * disfarce da coordenada não teria servido de nada.
 */
async function calcular({ latitude, longitude, alvo, ids }, contexto) {
  if (!coordenadaValida(latitude, longitude)) {
    throw erros.invalido('Coordenada de origem inválida.');
  }

  const registros = await carregarAlvos(alvo, ids);
  const origem = { latitude, longitude };
  const acaoLer = alvo === ALVO.ANUNCIO ? 'anuncio.ler' : 'perfil.ler';

  return registros.map((registro) => {
    const consentimento = consentimentoDoAlvo(alvo, registro);
    const exato = privacidade.podeVerExato(contexto, { ...consentimento, acaoLer });
    const bruta = distanciaKm(origem, coordenadaDoAlvo(alvo, registro));

    return {
      id: registro.id,
      distanciaKm: privacidade.distanciaDivulgavel(bruta, { exato }),
      aproximada: !exato,
    };
  });
}

/**
 * Fragmento de `where` para busca por proximidade.
 *
 * Devolve uma CAIXA, não um raio: `BETWEEN` em latitude/longitude usa o índice
 * composto que já existe nas tabelas; Haversine em SQL faria varredura completa.
 * Os cantos da caixa trazem alguns registros a mais — quem descarta é
 * `distanciaKm` na aplicação, sobre um punhado de linhas.
 */
function filtroDeProximidade({ latitude, longitude, raioKm = RAIO_BUSCA_PADRAO_KM }) {
  const raio = Math.min(Math.max(1, Number(raioKm) || RAIO_BUSCA_PADRAO_KM), RAIO_BUSCA_MAX_KM);
  const caixa = caixaDeRaio(latitude, longitude, raio);
  if (!caixa) return null;

  const { Op } = db.Sequelize;

  return {
    where: {
      latitude: { [Op.between]: [caixa.latitudeMin, caixa.latitudeMax] },
      longitude: { [Op.between]: [caixa.longitudeMin, caixa.longitudeMax] },
    },
    caixa,
    raioKm: raio,
  };
}

module.exports = { calcular, filtroDeProximidade, carregarAlvos };
