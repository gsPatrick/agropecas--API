'use strict';

const db = require('../../models');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const cachePerfil = require('./perfil.cache');
const { TIPOS_COM_HORARIO } = require('./perfil.constants');

/**
 * Horário de funcionamento (loja e prestador).
 *
 * Produtor não tem horário: ele não é ponto comercial, e a tela do front nem
 * mostra a seção. Deixar a API aceitar seria criar dado que ninguém lê e que
 * um dia apareceria numa listagem por engano.
 *
 * O banco tem `ck_horario_coerente` (`fechado = true OR (abre_as IS NOT NULL
 * AND fecha_as IS NOT NULL)`). A mesma regra é conferida aqui ANTES do INSERT —
 * não por desconfiança do banco, mas porque violação de CHECK volta como erro
 * de driver, e o usuário receberia um 500 em vez de "informe o horário de
 * abertura". A constraint continua sendo a garantia real contra corrida e
 * contra escrita fora da API.
 */

/** a semana é gravada como bloco; o cliente manda o que existe, o resto some */
async function definir(perfil, itens, contexto) {
  exigir(contexto, 'perfil.editar', { donoId: perfil.usuario_id });
  garantirTipo(perfil);

  const linhas = itens.map(conferir);
  conferirDiasUnicos(linhas);

  /* duas tabelas não, mas duas operações sim: apagar e recriar precisam ser
     atômicas, senão uma falha no meio deixa a loja sem horário nenhum */
  await db.sequelize.transaction(async (transacao) => {
    await db.PerfilHorario.destroy({ where: { perfil_id: perfil.id }, transaction: transacao });

    if (linhas.length) {
      await db.PerfilHorario.bulkCreate(
        linhas.map((linha) => ({ ...linha, perfil_id: perfil.id })),
        { transaction: transacao }
      );
    }
  });

  await cachePerfil.invalidar(perfil);
  return listar(perfil.id);
}

/** remove um dia — "fechei aos domingos" não deveria exigir reenviar a semana */
async function remover(perfil, diaSemana, contexto) {
  exigir(contexto, 'perfil.editar', { donoId: perfil.usuario_id });
  garantirTipo(perfil);

  const removidos = await db.PerfilHorario.destroy({
    where: { perfil_id: perfil.id, dia_semana: diaSemana },
  });

  await cachePerfil.invalidar(perfil);
  return { removido: removidos > 0 };
}

const listar = (perfilId) =>
  db.PerfilHorario.findAll({
    where: { perfil_id: perfilId },
    order: [['dia_semana', 'ASC']],
  });

function garantirTipo(perfil) {
  if (!TIPOS_COM_HORARIO.includes(perfil.tipo)) {
    throw erros.validacao({
      horarios: 'Somente loja e prestador de serviços têm horário de atendimento.',
    });
  }
}

/** espelha `ck_horario_coerente`, mas com mensagem que o usuário entende */
function conferir(item) {
  const fechado = Boolean(item.fechado);

  if (!fechado && (!item.abreAs || !item.fechaAs)) {
    throw erros.validacao({
      horarios: `Informe abertura e fechamento do dia ${item.diaSemana}, ou marque como fechado.`,
    });
  }

  if (!fechado && item.fechaAs <= item.abreAs) {
    /* atendimento que vira a meia-noite não existe em loja de peças; se um dia
       existir, isto vira um campo `vira_o_dia` e não uma exceção silenciosa */
    throw erros.validacao({
      horarios: `O fechamento precisa ser depois da abertura no dia ${item.diaSemana}.`,
    });
  }

  const temIntervalo = item.intervaloInicio || item.intervaloFim;
  if (!fechado && temIntervalo && !(item.intervaloInicio && item.intervaloFim)) {
    throw erros.validacao({
      horarios: `Informe início e fim do intervalo do dia ${item.diaSemana}.`,
    });
  }

  return {
    dia_semana: item.diaSemana,
    fechado,
    abre_as: fechado ? null : item.abreAs,
    fecha_as: fechado ? null : item.fechaAs,
    intervalo_inicio: fechado ? null : item.intervaloInicio || null,
    intervalo_fim: fechado ? null : item.intervaloFim || null,
  };
}

/** o índice único (perfil_id, dia_semana) já barra, mas o 422 explica melhor */
function conferirDiasUnicos(linhas) {
  const vistos = new Set();
  linhas.forEach((linha) => {
    if (vistos.has(linha.dia_semana)) {
      throw erros.validacao({ horarios: `O dia ${linha.dia_semana} aparece mais de uma vez.` });
    }
    vistos.add(linha.dia_semana);
  });
}

module.exports = { definir, remover, listar };
