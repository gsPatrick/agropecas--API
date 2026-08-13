'use strict';

const config = require('../../config');
const { obterJson } = require('../http');
const { somenteDigitos } = require('../../utils/texto');

/**
 * Provider do ViaCEP.
 *
 * A consulta é feita pelo SERVIDOR e não pelo navegador de propósito:
 *
 *  · o padrão de uso do usuário (quais CEPs ele pesquisa, e quando) não vai
 *    para um terceiro junto com o IP dele;
 *  · dá para cachear — CEP praticamente não muda, e cada acerto de cache é uma
 *    chamada a menos numa API pública que pode nos limitar sem aviso;
 *  · a indisponibilidade do terceiro é tratada num lugar só.
 *
 * Este arquivo só sabe falar ViaCEP e devolver um objeto do NOSSO formato.
 * Trocar por Brasil API é reescrever `normalizar` e a URL — nenhum service
 * sabe de onde o endereço veio.
 */

const SERVICO = 'consulta de CEP';

/* 4 segundos: o ViaCEP responde em ~300 ms quando está bem. Acima disso, quem
   está preenchendo um formulário já desistiu e digitou o endereço na mão */
const TIMEOUT_MS = 4000;

const cepValido = (cep) => /^\d{8}$/.test(cep);

/** ViaCEP → formato interno (as chaves do model `enderecos`) */
const normalizar = (bruto) => ({
  cep: somenteDigitos(bruto.cep),
  logradouro: bruto.logradouro || null,
  complemento: bruto.complemento || null,
  bairro: bruto.bairro || null,
  municipioNome: bruto.localidade || null,
  uf: bruto.uf || null,
  codigoIbge: bruto.ibge ? Number(bruto.ibge) : null,
  ddd: bruto.ddd || null,
  /* guardado para auditoria da origem do dado (`enderecos.retorno_bruto`):
     quando o usuário reclamar que o bairro veio errado, dá para provar que
     veio assim da fonte */
  bruto,
});

/**
 * Busca um CEP.
 *
 * @returns {Promise<{encontrado: boolean, endereco: object|null}>}
 * @throws  {AppError} 503 quando o ViaCEP está fora ou travado
 */
async function buscar(cepEntrada) {
  const cep = somenteDigitos(cepEntrada);
  if (!cepValido(cep)) return { encontrado: false, endereco: null };

  const url = `${config.integracoes.viacepBaseUrl}/${cep}/json/`;
  const resposta = await obterJson(url, { servico: SERVICO, timeoutMs: TIMEOUT_MS });

  /* o ViaCEP responde 200 com `{ "erro": true }` para CEP inexistente — tratar
     só pelo status HTTP daria "encontrado" para um endereço vazio */
  const dados = resposta.dados;
  if (!resposta.encontrado || !dados || dados.erro || !dados.cep) {
    return { encontrado: false, endereco: null };
  }

  return { encontrado: true, endereco: normalizar(dados) };
}

module.exports = { buscar, SERVICO, TIMEOUT_MS };
