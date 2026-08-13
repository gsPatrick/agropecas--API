'use strict';

const privacidade = require('./localizacao.privacidade.service');

/**
 * Model → JSON da API.
 *
 * Lista branca explícita. Nada de instância do Sequelize na resposta: além do
 * schema inteiro vazar, aqui vazaria `retorno_bruto` — a resposta CRUA do
 * ViaCEP/BigDataCloud, que existe para auditoria interna e não tem por que
 * chegar ao navegador de ninguém.
 */

/**
 * Endereço já passado pelo filtro de privacidade.
 *
 * O mapper NÃO decide quem vê o quê — quem decide é
 * `localizacao.privacidade.service`. Aqui só se garante que ninguém devolva um
 * endereço sem passar por lá: a única porta é esta função, e ela exige o
 * `exato` calculado.
 */
const endereco = (registro, { exato = false } = {}) => privacidade.aplicar(registro, { exato });

/** resultado da consulta de CEP — nunca inclui `retornoBruto` */
const consultaCep = (resultado) => ({
  encontrado: resultado.encontrado,
  endereco: resultado.endereco || null,
  /* o front mostra "preencha o número" quando veio do cache e nada mudou */
  origemCache: Boolean(resultado.origemCache),
});

const consultaCoordenada = (resultado) => ({
  encontrado: resultado.encontrado,
  endereco: resultado.endereco || null,
  origemCache: Boolean(resultado.origemCache),
});

const estado = (registro) => ({
  id: registro.id,
  uf: registro.uf,
  nome: registro.nome,
  codigoIbge: registro.codigoIbge ?? registro.codigo_ibge,
  regiao: registro.regiao,
});

const municipio = (registro) => ({
  id: registro.id,
  nome: registro.nome,
  uf: registro.uf,
  codigoIbge: registro.codigoIbge ?? registro.codigo_ibge,
  latitude: registro.latitude ?? null,
  longitude: registro.longitude ?? null,
});

const distancia = (item) => ({
  id: item.id,
  distanciaKm: item.distanciaKm,
  aproximada: item.aproximada,
});

module.exports = { endereco, consultaCep, consultaCoordenada, estado, municipio, distancia };
