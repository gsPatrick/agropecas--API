'use strict';

const cache = require('../../cache');
const viacep = require('../../providers/viacep');
const territorio = require('./localizacao.territorio.service');
const { chaves } = require('./localizacao.cache');
const { TTL } = require('./localizacao.constants');
const { somenteDigitos } = require('../../utils/texto');
const { erros } = require('../../utils/erros');

/**
 * Consulta de CEP.
 *
 * O service NÃO fala HTTP — quem fala é `providers/viacep`. Aqui mora o que é
 * nosso: cache, resolução do município na nossa tabela e o formato que o front
 * consome.
 *
 * **Resiliência:** o ViaCEP é público e gratuito, o que significa que um dia
 * ele vai estar fora. Quando estiver, esta consulta devolve 503 tratado com a
 * mensagem "preencha manualmente" — nunca 500, e nunca uma exceção que derrube
 * o cadastro inteiro. O usuário sempre consegue digitar o endereço na mão; o
 * CEP é conveniência, não requisito.
 */

/**
 * @returns {{encontrado: boolean, endereco: object|null, origemCache: boolean}}
 * @throws  {AppError} 503 quando o ViaCEP não responde
 */
async function consultar(cepEntrada) {
  const cep = somenteDigitos(cepEntrada);
  if (cep.length !== 8) throw erros.invalido('CEP inválido.', { campo: 'cep' });

  const chave = chaves.cep(cep);

  const guardado = await cache.obter(chave);
  if (guardado !== undefined) return { ...guardado, origemCache: true };

  const { encontrado, endereco } = await viacep.buscar(cep);

  if (!encontrado) {
    const vazio = { encontrado: false, endereco: null };
    /* "esse CEP não existe" também vale guardar — é a resposta que mais se
       repete quando alguém erra um dígito e insiste. TTL menor que o do CEP
       válido, porque CEP novo é criado com mais frequência do que CEP muda */
    await cache.gravar(chave, vazio, { ttl: TTL.cepInexistente });
    return { ...vazio, origemCache: false };
  }

  const municipio = await territorio.resolverMunicipio({
    codigoIbge: endereco.codigoIbge,
    nome: endereco.municipioNome,
    uf: endereco.uf,
  });

  const resultado = {
    encontrado: true,
    endereco: {
      cep: endereco.cep,
      logradouro: endereco.logradouro,
      complemento: endereco.complemento,
      bairro: endereco.bairro,
      municipioId: municipio ? municipio.id : null,
      municipioNome: municipio ? municipio.nome : endereco.municipioNome,
      uf: endereco.uf,
      /* a sede do município é o melhor palpite de coordenada quando só se tem
         o CEP: o ViaCEP não devolve lat/lon, e sem nenhuma coordenada o anúncio
         some do mapa e do cálculo de distância */
      latitude: municipio && municipio.latitude !== null ? Number(municipio.latitude) : null,
      longitude: municipio && municipio.longitude !== null ? Number(municipio.longitude) : null,
      precisao: 'aproximada',
      origem: 'cep',
    },
    /* mantido fora de `endereco` para não ir parar na resposta da API sem
       alguém decidir — é dado de auditoria, não de tela */
    retornoBruto: endereco.bruto,
  };

  await cache.gravar(chave, resultado, { ttl: TTL.cep });
  return { ...resultado, origemCache: false };
}

module.exports = { consultar };
