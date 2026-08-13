'use strict';

const { campos, esquema } = require('../../validacao');
const { PERIODOS, PERIODICIDADES } = require('./plano.constants');

/**
 * Esquemas de entrada do módulo de plano.
 *
 * O campo que mais exige atenção é `valor` do limite: ele precisa aceitar
 * `null` EXPLÍCITO, porque null é "ilimitado" e não "campo esquecido". Por
 * isso `permitindoNulo()` — sem ele, o Admin não teria como voltar um plano
 * para ilimitado depois de ter posto um teto.
 */

const identificador = esquema({
  id: campos.uuid().obrigatorio('Informe o identificador.'),
});

/* a chave do limite vira parte da URL: fechar o formato aqui evita que
   qualquer texto do cliente chegue ao `where` da consulta de uso */
const chaveDeLimite = esquema({
  chave: campos
    .texto()
    .obrigatorio()
    .max(60)
    .minusculo()
    .padraoTexto(/^[a-z0-9_.]+$/, 'Chave de limite inválida.'),
});

const limite = campos.objeto({
  chave: campos.texto().obrigatorio('Informe a chave do limite.').min(2).max(60),
  valor: campos.inteiro().min(0, 'Limite não pode ser negativo.').permitindoNulo(),
  periodo: campos.umDe(PERIODOS).padrao('total'),
  descricao: campos.texto().max(255),
});

const criar = esquema({
  chave: campos
    .texto()
    .obrigatorio('Informe a chave do plano.')
    .min(3)
    .max(40)
    .minusculo()
    .padraoTexto(/^[a-z0-9_]+$/, 'Use apenas letras minúsculas, números e underline.'),
  nome: campos.texto().obrigatorio('Informe o nome do plano.').min(2).max(80),
  descricao: campos.textoLongo().max(1000),
  precoCentavos: campos.inteiro().min(0).padrao(0),
  periodicidade: campos.umDe(PERIODICIDADES).padrao('vitalicio'),
  diasTeste: campos.inteiro().min(0).max(365).padrao(0),
  publico: campos.booleano().padrao(true),
  ativo: campos.booleano().padrao(true),
  ordem: campos.inteiro().min(0).padrao(0),
  limites: campos.lista(limite),
});

const editar = esquema({
  nome: campos.texto().min(2).max(80),
  descricao: campos.textoLongo().max(1000),
  precoCentavos: campos.inteiro().min(0),
  periodicidade: campos.umDe(PERIODICIDADES),
  diasTeste: campos.inteiro().min(0).max(365),
  publico: campos.booleano(),
  ativo: campos.booleano(),
  ordem: campos.inteiro().min(0),
  limites: campos.lista(limite),
});

const definirLimites = esquema({
  limites: campos.lista(limite).obrigatorio('Informe a lista de limites.'),
});

/**
 * `usuarioId` vem do corpo aqui — e só aqui — porque atribuir plano é ação do
 * Admin SOBRE outra pessoa. É a exceção consciente à regra "id sai do
 * contexto" (padrão §11.2); a rota exige `plano.atribuir`, que só o Admin tem.
 */
const atribuir = esquema({
  usuarioId: campos.uuid().obrigatorio('Informe o usuário.'),
  planoId: campos.uuid(),
  planoChave: campos.texto().max(40).minusculo(),
  motivo: campos.texto().max(255),
  fimEm: campos.data(),
});

const listagem = esquema({
  incluirInativos: campos.booleano().padrao(false),
  incluirOcultos: campos.booleano().padrao(false),
});

module.exports = {
  identificador,
  chaveDeLimite,
  criar,
  editar,
  definirLimites,
  atribuir,
  listagem,
};
