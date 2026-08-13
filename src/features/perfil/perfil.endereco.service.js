'use strict';

const db = require('../../models');
const { coordenadaValida } = require('../../utils/geo');

/**
 * Endereço do perfil escrito junto com o resto do cadastro.
 *
 * POR QUE EXISTE, se `POST /localizacao/enderecos` já grava endereço: aquele
 * endpoint é a tela de mapa, com `alvo`/`alvoId` no corpo e consentimento de
 * exibição. O cadastro e a edição de perfil mandam CEP, logradouro, número,
 * complemento e bairro no mesmo formulário do resto — e até aqui a API jogava
 * tudo fora e guardava só o município. Quem se cadastrava informando o endereço
 * inteiro via o campo em branco na volta.
 *
 * O CONTRATO DE DONO NÃO MUDA: o endereço continua sem dono próprio — quem tem
 * dono é o perfil. Este service nunca decide permissão; ele é chamado **depois**
 * de `exigir(ctx, 'perfil.editar', { donoId })`, de dentro do service de edição,
 * ou dentro da transação do cadastro, onde o perfil está sendo criado pelo
 * próprio titular.
 *
 * Também não aceita `latitude`/`longitude` do corpo: a coordenada vem da sede do
 * município. Deixar o formulário de cadastro mandar ponto exato daria a qualquer
 * um um endereço "preciso" que ninguém conferiu — a marcação no mapa é a tela de
 * localização, que deriva `precisao` da origem.
 */

/** só os campos de endereço; ausência de todos significa "não mexer" */
const CAMPOS = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'referencia'];

const temAlgo = (dados) =>
  Boolean(dados) && CAMPOS.some((campo) => dados[campo] !== undefined) ;

/**
 * Monta os valores da tabela `enderecos` a partir do bloco do formulário.
 *
 * O município manda na UF e na coordenada: aceitar UF solta do cliente abriria
 * divergência com `municipio_id`, e é a mesma regra que `perfil.edicao` já
 * aplica em `resolverLocalizacao`.
 */
async function montarValores(dados, municipioId, { transacao } = {}) {
  const municipio = municipioId
    ? await db.Municipio.findByPk(municipioId, {
        attributes: ['id', 'nome', 'uf', 'latitude', 'longitude'],
        transaction: transacao,
      })
    : null;

  const valores = {
    municipio_id: municipio ? municipio.id : null,
    municipio_nome: municipio ? municipio.nome : null,
    uf: municipio ? municipio.uf : null,
    latitude:
      municipio && coordenadaValida(municipio.latitude, municipio.longitude)
        ? municipio.latitude
        : null,
    longitude:
      municipio && coordenadaValida(municipio.latitude, municipio.longitude)
        ? municipio.longitude
        : null,
    /* `origem` registra como o dado chegou, e daqui ele chega digitado: com CEP
       é 'cep', sem CEP é só o município. `precisao` fica 'aproximada' nos dois
       casos porque ninguém conferiu o ponto — ver o comentário de
       `derivarPrecisao` em localizacao */
    origem: dados.cep ? 'cep' : 'municipio',
    precisao: 'aproximada',
  };

  CAMPOS.forEach((campo) => {
    if (dados[campo] !== undefined) valores[campo] = dados[campo] || null;
  });

  return valores;
}

/**
 * Cria ou atualiza o endereço do perfil e devolve o id para denormalizar.
 *
 * Reaproveita a linha existente em vez de criar outra: trocar de linha a cada
 * edição deixaria `enderecos` cheia de órfãs e quebraria qualquer histórico que
 * aponte para o id antigo.
 */
async function salvar(perfil, dados, { transacao, municipioId } = {}) {
  if (!temAlgo(dados)) return null;

  const alvoMunicipio = municipioId !== undefined ? municipioId : perfil.municipio_id;
  const valores = await montarValores(dados, alvoMunicipio, { transacao });

  let endereco = perfil.endereco_id
    ? await db.Endereco.findByPk(perfil.endereco_id, { transaction: transacao })
    : null;

  if (endereco) await endereco.update(valores, { transaction: transacao });
  else endereco = await db.Endereco.create(valores, { transaction: transacao });

  return endereco;
}

/** os mesmos valores, para quem ainda não tem perfil criado (cadastro) */
async function criarParaCadastro(dados, municipioId, { transacao } = {}) {
  if (!temAlgo(dados)) return null;

  const valores = await montarValores(dados, municipioId, { transacao });
  return db.Endereco.create(valores, { transaction: transacao });
}

module.exports = { salvar, criarParaCadastro, temAlgo, CAMPOS };
