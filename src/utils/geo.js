'use strict';

const crypto = require('crypto');

/**
 * Geometria de superfície — funções PURAS, sem banco, sem HTTP.
 *
 * Vive em `utils` e não na feature de localização porque distância é conta que
 * anúncio, perfil e busca vão querer fazer, e duplicar Haversine em três
 * lugares é como se ganha três resultados ligeiramente diferentes para a mesma
 * pergunta.
 */

const RAIO_TERRA_KM = 6371;

const grausParaRadianos = (graus) => (graus * Math.PI) / 180;

const numero = (valor) => (valor === null || valor === undefined ? NaN : Number(valor));

/**
 * Coordenada utilizável?
 *
 * `0,0` é recusado de propósito: é a "Ilha Nula" no Golfo da Guiné, e na
 * prática significa campo não preenchido que virou zero em algum lugar do
 * caminho. Aceitar isso colocaria anúncios de Sorriso no meio do Atlântico.
 */
function coordenadaValida(latitude, longitude) {
  const lat = numero(latitude);
  const lon = numero(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  return !(lat === 0 && lon === 0);
}

/**
 * Distância em linha reta entre dois pontos (Haversine), em quilômetros.
 *
 * Haversine e não Vincenty: o erro do modelo esférico é de ~0,3%, o que em
 * 200 km dá 600 m — irrelevante para "quanto tempo de estrada até essa peça" e
 * muito mais barato de calcular para uma lista inteira de anúncios.
 *
 * @returns {number|null} null quando qualquer ponto não tem coordenada usável
 */
function distanciaKm(origem, destino) {
  if (!origem || !destino) return null;
  if (!coordenadaValida(origem.latitude, origem.longitude)) return null;
  if (!coordenadaValida(destino.latitude, destino.longitude)) return null;

  const lat1 = grausParaRadianos(numero(origem.latitude));
  const lat2 = grausParaRadianos(numero(destino.latitude));
  const deltaLat = lat2 - lat1;
  const deltaLon = grausParaRadianos(numero(destino.longitude) - numero(origem.longitude));

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  const distancia = 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(a)));

  /* uma casa decimal: "128,4 km" é o que o usuário lê. Devolver 128,43719 dá
     falsa impressão de precisão que a coordenada de origem não tem */
  return Math.round(distancia * 10) / 10;
}

/**
 * Caixa envolvente de um raio, para PRÉ-FILTRAR no banco.
 *
 * Haversine em SQL não usa índice; comparar latitude/longitude com um `BETWEEN`
 * usa. O padrão é: caixa no banco (barato, aproximado, aproveita o índice de
 * `latitude, longitude`) e Haversine na aplicação sobre o punhado de linhas que
 * sobrou. A caixa devolve alguns pontos a mais nos cantos — quem descarta é o
 * cálculo exato depois.
 */
function caixaDeRaio(latitude, longitude, raioKm) {
  if (!coordenadaValida(latitude, longitude) || !(raioKm > 0)) return null;

  const lat = numero(latitude);
  const lon = numero(longitude);

  const grausLat = raioKm / 111.32;
  /* o meridiano encolhe conforme se sobe: em MT (~ -13°) um grau de longitude
     tem ~108 km, no equador 111 km. Ignorar o cosseno faria a caixa estreitar
     de menos e trazer lixo */
  const cosseno = Math.max(0.01, Math.cos(grausParaRadianos(lat)));
  const grausLon = raioKm / (111.32 * cosseno);

  return {
    latitudeMin: Math.max(-90, lat - grausLat),
    latitudeMax: Math.min(90, lat + grausLat),
    longitudeMin: Math.max(-180, lon - grausLon),
    longitudeMax: Math.min(180, lon + grausLon),
  };
}

/**
 * Ofuscação de coordenada — o coração da privacidade do produtor.
 *
 * Regra da cliente (Maturacao/05 §9.3): o produtor costuma anunciar da própria
 * casa. Quando `exibir_endereco_exato` é falso, o público recebe um ponto
 * DESLOCADO, nunca o real.
 *
 * Duas decisões que parecem detalhe e não são:
 *
 * 1. **O deslocamento é determinístico**, derivado de uma semente estável (o id
 *    do endereço). Se fosse aleatório por requisição, bastaria pedir o mesmo
 *    anúncio vinte vezes e tirar a média dos pontos para recuperar o centro
 *    verdadeiro com precisão melhor do que o raio — a proteção viraria ruído
 *    cancelável.
 * 2. **A saída é arredondada** para 3 casas (~110 m) depois do deslocamento, o
 *    que impede reconhecer o offset pela cauda decimal.
 *
 * O raio padrão de 3 km é maior que a maioria dos lotes rurais e menor que a
 * distância típica entre sedes — mantém o pino "na região certa" sem apontar a
 * porteira.
 */
function ofuscarCoordenada(latitude, longitude, { raioMetros = 3000, semente = '' } = {}) {
  if (!coordenadaValida(latitude, longitude)) return null;

  const digest = crypto.createHash('sha256').update(String(semente)).digest();

  /* dois números estáveis em [0,1) a partir da semente */
  const fracao = (deslocamento) => digest.readUInt32BE(deslocamento) / 0x1_00_00_00_00;

  const angulo = fracao(0) * 2 * Math.PI;
  /* raiz quadrada distribui o ponto uniformemente na ÁREA do disco; sem ela o
     deslocamento se concentra perto do centro e o disfarce fica fraco */
  const distanciaKmDeslocada = (raioMetros / 1000) * Math.sqrt(fracao(4));

  const lat = numero(latitude);
  const lon = numero(longitude);
  const cosseno = Math.max(0.01, Math.cos(grausParaRadianos(lat)));

  const novaLatitude = lat + (distanciaKmDeslocada * Math.cos(angulo)) / 111.32;
  const novaLongitude = lon + (distanciaKmDeslocada * Math.sin(angulo)) / (111.32 * cosseno);

  return {
    latitude: Number(novaLatitude.toFixed(3)),
    longitude: Number(novaLongitude.toFixed(3)),
  };
}

/** arredondamento usado em chave de cache de geocodificação (~110 m de grade) */
const arredondarCoordenada = (valor, casas = 3) =>
  Number.isFinite(numero(valor)) ? Number(numero(valor).toFixed(casas)) : null;

module.exports = {
  RAIO_TERRA_KM,
  coordenadaValida,
  distanciaKm,
  caixaDeRaio,
  ofuscarCoordenada,
  arredondarCoordenada,
};
