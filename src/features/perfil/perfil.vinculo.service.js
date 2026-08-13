'use strict';

const db = require('../../models');
const { exigir, pode } = require('../../rbac');
const { erros } = require('../../utils/erros');
const cachePerfil = require('./perfil.cache');
const { COLECOES, MAXIMO_POR_COLECAO } = require('./perfil.constants');

/**
 * Coleções N:N do perfil: serviços prestados, marcas atendidas e municípios da
 * área de atendimento.
 *
 * Um service para as três porque a mecânica é literalmente a mesma — conjunto
 * de ids com colunas extras na tabela de ligação. Três arquivos quase idênticos
 * garantiriam que, no dia da correção, só um dos três fosse corrigido. O que
 * varia (nome da coluna, quais extras, qual model de destino) é dado, e vive em
 * `perfil.constants.js`.
 *
 * A área de atendimento é o que faz uma busca em Sapezal encontrar quem atende
 * lá mesmo estando sediado em Tangará — por isso ela é filtro da listagem
 * pública, e não enfeite do perfil.
 */

function descrever(colecao) {
  const definicao = COLECOES[colecao];
  if (!definicao) throw erros.naoEncontrado('Coleção');
  return definicao;
}

/** camelCase do corpo → coluna da tabela de ligação */
const EXTRA_PARA_COLUNA = {
  precoReferenciaCentavos: 'preco_referencia_centavos',
  taxaDeslocamentoCentavos: 'taxa_deslocamento_centavos',
  observacao: 'observacao',
  principal: 'principal',
  autorizada: 'autorizada',
};

/**
 * Filtra os extras que este vínculo aceita e derruba os que exigem Admin.
 *
 * `autorizada` (revenda autorizada da marca) é o caso concreto: é um selo
 * comercial que só vale se alguém conferiu o contrato de representação. Se o
 * próprio lojista pudesse marcá-lo, o selo não significaria nada.
 */
function extrasPermitidos(definicao, dados, contexto) {
  const saida = {};

  definicao.extras.forEach((coluna) => {
    const chave = Object.keys(EXTRA_PARA_COLUNA).find((nome) => EXTRA_PARA_COLUNA[nome] === coluna);
    if (!chave || dados[chave] === undefined) return;

    if (definicao.somenteAdmin.includes(coluna) && !pode(contexto, 'perfil.verificar')) return;

    saida[coluna] = dados[chave];
  });

  return saida;
}

/** todos os ids precisam existir no catálogo — uma consulta, não um laço */
async function conferirExistencia(definicao, ids) {
  if (!ids.length) return;

  const encontrados = await db[definicao.alvo].count({ where: { id: ids } });
  if (encontrados !== ids.length) {
    throw erros.validacao({ itens: `${definicao.rotulo} inválido ou inexistente na lista.` });
  }
}

/**
 * Substitui o conjunto inteiro. É a operação que a tela usa: o usuário marca
 * checkboxes e salva — mandar diffs faria o front reimplementar aqui a lógica
 * de conjunto que o banco já sabe fazer.
 */
async function definir(perfil, colecao, itens, contexto) {
  exigir(contexto, 'perfil.editar', { donoId: perfil.usuario_id });

  const definicao = descrever(colecao);
  const unicos = [...new Map(itens.map((item) => [item.id, item])).values()];

  if (unicos.length > MAXIMO_POR_COLECAO) {
    throw erros.validacao({ itens: `No máximo ${MAXIMO_POR_COLECAO} itens.` });
  }

  await conferirExistencia(definicao, unicos.map((item) => item.id));

  await db.sequelize.transaction(async (transacao) => {
    await db[definicao.ligacao].destroy({
      where: { perfil_id: perfil.id },
      transaction: transacao,
    });

    if (unicos.length) {
      /* bulkCreate e não laço de save(): 40 municípios viram um INSERT, não 40
         idas ao banco dentro de uma transação aberta */
      await db[definicao.ligacao].bulkCreate(
        unicos.map((item) => ({
          perfil_id: perfil.id,
          [definicao.coluna]: item.id,
          ...extrasPermitidos(definicao, item, contexto),
        })),
        { transaction: transacao }
      );
    }
  });

  await cachePerfil.invalidar(perfil);
  return listar(perfil.id, colecao);
}

/** vincula um item só — o botão "adicionar" da tela, sem reenviar o conjunto */
async function vincular(perfil, colecao, dados, contexto) {
  exigir(contexto, 'perfil.editar', { donoId: perfil.usuario_id });

  const definicao = descrever(colecao);
  await conferirExistencia(definicao, [dados.id]);

  const total = await db[definicao.ligacao].count({ where: { perfil_id: perfil.id } });
  if (total >= MAXIMO_POR_COLECAO) {
    throw erros.validacao({ itens: `No máximo ${MAXIMO_POR_COLECAO} itens.` });
  }

  const valores = {
    perfil_id: perfil.id,
    [definicao.coluna]: dados.id,
    ...extrasPermitidos(definicao, dados, contexto),
  };

  /* o índice único (perfil_id, alvo_id) já impede duplicata; vincular duas
     vezes é gesto normal de usuário impaciente, e deve atualizar em vez de
     estourar 409 */
  const [registro, criado] = await db[definicao.ligacao].findOrCreate({
    where: { perfil_id: perfil.id, [definicao.coluna]: dados.id },
    defaults: valores,
  });

  if (!criado) await registro.update(valores);

  await cachePerfil.invalidar(perfil);
  return registro;
}

async function desvincular(perfil, colecao, alvoId, contexto) {
  exigir(contexto, 'perfil.editar', { donoId: perfil.usuario_id });

  const definicao = descrever(colecao);
  const removidos = await db[definicao.ligacao].destroy({
    where: { perfil_id: perfil.id, [definicao.coluna]: alvoId },
  });

  await cachePerfil.invalidar(perfil);
  return { removido: removidos > 0 };
}

/** leitura da coleção isolada, para a tela de edição */
function listar(perfilId, colecao) {
  const definicao = descrever(colecao);

  return db[definicao.ligacao].findAll({ where: { perfil_id: perfilId } });
}

module.exports = { definir, vincular, desvincular, listar, descrever };
