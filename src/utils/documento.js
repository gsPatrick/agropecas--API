'use strict';

const { somenteDigitos } = require('./texto');

/**
 * Validação de CPF e CNPJ.
 *
 * Validar o dígito verificador evita o caso mais comum de cadastro sujo: o
 * usuário digita errado, ninguém percebe, e o documento só é conferido meses
 * depois — quando já existe negociação em cima dele.
 */

function validarCpf(valor) {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digito = (fatiaAte, pesoInicial) => {
    let soma = 0;
    for (let i = 0; i < fatiaAte; i += 1) soma += Number(cpf[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(9, 10) === Number(cpf[9]) && digito(10, 11) === Number(cpf[10]);
}

function validarCnpj(valor) {
  const cnpj = somenteDigitos(valor);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calcular = (fatiaAte) => {
    const pesos = fatiaAte === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < fatiaAte; i += 1) soma += Number(cnpj[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calcular(12) === Number(cnpj[12]) && calcular(13) === Number(cnpj[13]);
}

const validarDocumento = (valor) => {
  const digitos = somenteDigitos(valor);
  if (digitos.length === 11) return validarCpf(digitos);
  if (digitos.length === 14) return validarCnpj(digitos);
  return false;
};

const tipoDocumento = (valor) => {
  const digitos = somenteDigitos(valor);
  if (digitos.length === 11) return 'cpf';
  if (digitos.length === 14) return 'cnpj';
  return null;
};

module.exports = { validarCpf, validarCnpj, validarDocumento, tipoDocumento };
