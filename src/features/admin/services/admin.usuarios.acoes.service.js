'use strict';

const { Op } = require('sequelize');
const db = require('../../../models');
const { exigir } = require('../../../rbac');
const { erros } = require('../../../utils/erros');
const { adicionarDias } = require('../../../utils/datas');
const tempoReal = require('../../../tempo-real');
const filas = require('../../../filas');

const moderacaoUsuario = require('../../moderacao/moderacao.usuario.service');
const { exigirMotivo, garantirPodeAgirSobre } = require('../../moderacao/moderacao.comum');
const { MOTIVO_REVOGACAO, SUSPENSAO } = require('../../moderacao/moderacao.constants');
const contaService = require('../../usuario/usuario.perfil.service');
const sessaoService = require('../../auth/auth.sessao.service');

const { registrarAcao, registrarLote } = require('../helpers/admin.auditoria.helper');
const { garantirLote } = require('../helpers/admin.contexto.helper');
const compartilhado = require('./admin.shared');

/**
 * As ações do painel sobre uma conta.
 *
 * **Composição, não cópia.** Suspender continua sendo
 * `moderacao.usuario.service.suspender`: é lá que moram o motivo obrigatório,
 * a trava de não punir a si mesmo, a regra de que moderador não age sobre
 * Admin, a derrubada de sessão e a notificação ao afetado. Reescrever isso
 * aqui garantiria que um dia as duas versões divergissem — e a que divergisse
 * seria a que ninguém revisa.
 *
 * A auditoria dessas três ações também é do service composto, e de propósito:
 * uma segunda linha registrando o mesmo banimento transformaria a trilha em
 * relatório com tudo em dobro, justamente no evento que mais importa revisar.
 * O helper `admin.auditoria.helper` é usado no que a composição NÃO cobre —
 * encerramento de sessão, anotação interna e o lote.
 *
 * O que este arquivo acrescenta de fato é a **ação em lote**, que nenhuma
 * feature pode oferecer sozinha.
 */

/** o painel mostra contadores; qualquer escrita daqui mexe em pelo menos um */
const invalidar = () => compartilhado.invalidarPainel();

/**
 * Edição de cadastro pelo Admin.
 *
 * Os campos comuns vão para `usuario.perfil.service.atualizar`, que já sabe
 * quais são editáveis, já exige `usuario.editar` com o dono conhecido e já
 * grava `em_nome_de` quando o autor não é o titular.
 *
 * `observacoesInternas` fica aqui porque não é dado do titular: é anotação de
 * atendimento sobre ele. Não existe no fluxo do usuário comum e não pode
 * existir — se entrasse no `montarAlteracao` da feature, bastaria mandar o
 * campo no corpo de `PATCH /usuarios/eu` para qualquer pessoa escrever no
 * próprio prontuário.
 */
async function editar(contexto, id, dados = {}) {
  const usuario = await contaService.atualizar(contexto, dados, id);

  if (dados.observacaoInterna !== undefined) {
    compartilhado.exigirEscopoTotal(
      contexto,
      'usuario.editar',
      'Anotação interna exige escopo total em usuário.'
    );

    const antes = { observacoes_internas: usuario.observacoes_internas };
    await usuario.update({ observacoes_internas: dados.observacaoInterna || null });

    await registrarAcao(contexto, {
      acao: 'editar',
      entidade: 'usuarios',
      entidadeId: usuario.id,
      antes,
      depois: { observacoes_internas: dados.observacaoInterna || null },
      motivo: dados.motivo || 'anotação interna do atendimento',
      emNomeDe: id,
    });
  }

  await invalidar();
  return usuario;
}

/** suspensão temporária — a regra inteira vem da mesa de moderação */
async function suspender(contexto, id, { motivo, dias, ate } = {}) {
  /* a tela do painel pede prazo em data ("suspenso até"), a feature trabalha em
     dias. Converter aqui evita duas noções de prazo no banco */
  const prazoEmDias = dias || (ate ? Math.ceil((new Date(ate) - Date.now()) / 86400000) : undefined);

  if (ate && !(prazoEmDias > 0)) {
    throw erros.validacao({ ate: 'A suspensão precisa terminar no futuro.' });
  }

  const resultado = await moderacaoUsuario.suspender(contexto, id, { motivo, dias: prazoEmDias });
  await invalidar();
  return resultado;
}

async function banir(contexto, id, { motivo } = {}) {
  const resultado = await moderacaoUsuario.banir(contexto, id, { motivo });
  await invalidar();
  return resultado;
}

async function restaurar(contexto, id, { motivo } = {}) {
  const resultado = await moderacaoUsuario.restaurar(contexto, id, { motivo });
  await invalidar();
  return resultado;
}

/**
 * Derrubar todas as sessões de uma conta.
 *
 * É a ação de suporte para "minha conta foi invadida": não muda o status, só
 * corta o acesso de quem já está dentro. Diferente da sanção, pode ser
 * aplicada à própria conta — quem perdeu o notebook precisa exatamente disso.
 *
 * Não é operação punitiva, mas é intervenção na conta de terceiro: por isso
 * grava auditoria com `em_nome_de` apontando o titular.
 */
async function encerrarSessoes(contexto, id) {
  exigir(contexto, 'usuario.encerrar_sessoes', { donoId: id });

  const usuario = await db.Usuario.findByPk(id, { attributes: ['id'] });
  if (!usuario) throw erros.naoEncontrado('Usuário');

  const encerradas = await sessaoService.encerrarTodas(id, {
    motivo: MOTIVO_REVOGACAO.SUSPENSAO,
  });

  /* o evento é entrega complementar, nunca o registro do fato: se o WebSocket
     estiver fora, a sessão já morreu no banco e a tela cai no próximo pedido */
  tempoReal.paraUsuario(id, tempoReal.EVENTOS.SESSAO_ENCERRADA, {
    motivo: 'sessoes_encerradas_pelo_suporte',
  });

  await registrarAcao(contexto, {
    acao: 'logout',
    entidade: 'sessoes',
    entidadeId: id,
    depois: { sessoes_encerradas: encerradas },
    motivo: 'encerramento de sessões pelo painel',
    emNomeDe: String(id) === String(contexto.usuarioId) ? null : id,
  });

  return { sessoesEncerradas: encerradas };
}

/** teto do lote — o helper aplica, mas o número é decisão desta tela */
const MAXIMO_LOTE = 50;

/**
 * Cada ação em lote com a permissão que ela exige — a mesma da versão
 * individual. Uma tabela e não um `if`: o dia em que alguém acrescentar uma
 * ação aqui sem permissão correspondente, a linha fica visivelmente incompleta.
 */
const ACOES_EM_LOTE = {
  suspender: { permissao: 'usuario.suspender', auditoria: 'suspender', derrubaSessao: true },
  banir: { permissao: 'usuario.banir', auditoria: 'banir', derrubaSessao: true },
  restaurar: { permissao: 'usuario.restaurar', auditoria: 'restaurar', derrubaSessao: false },
};

/**
 * Sanção em massa.
 *
 * Este é o único ponto do módulo que escreve status de conta sem passar pela
 * mesa de moderação, e a razão é aritmética: chamar o service por registro
 * geraria uma linha de auditoria, uma notificação e um `UPDATE` por conta —
 * "suspendi 40 perfis de spam" viraria 40 linhas idênticas na trilha, e a
 * trilha vira ruído justamente no evento que mais importa revisar depois.
 *
 * O que NÃO é abreviado são as travas: cada alvo passa por
 * `garantirPodeAgirSobre` (não é você mesmo, e você é Admin se ele for), o
 * motivo é exigido pelo mesmo `exigirMotivo` da moderação, e o teto vem do
 * helper. A escrita é `UPDATE ... WHERE id IN (...)`, não um laço de `save()`.
 */
async function sancionarEmLote(contexto, { ids = [], acao, motivo, dias, notificar } = {}) {
  const alvos = [...new Set((ids || []).map(String))];

  const definicao = ACOES_EM_LOTE[acao];
  if (!definicao) {
    throw erros.validacao({ acao: 'Ação em lote inválida. Use "suspender", "banir" ou "restaurar".' });
  }
  if (!alvos.length) throw erros.validacao({ ids: 'Informe ao menos um usuário.' });

  garantirLote(contexto, alvos.length, MAXIMO_LOTE);
  exigir(contexto, definicao.permissao);

  const justificativa = exigirMotivo(motivo);

  if (alvos.includes(String(contexto.usuarioId))) {
    throw erros.semPermissao('Você não pode aplicar uma sanção sobre si mesmo.', {
      code: 'CONFLITO_DE_INTERESSE',
    });
  }

  /* as travas por alvo rodam ANTES de qualquer escrita: um lote parcialmente
     aplicado é o pior resultado possível — metade das contas punidas e uma
     mensagem de erro que não diz qual metade */
  await Promise.all(alvos.map((id) => garantirPodeAgirSobre(contexto, id)));

  const prazo = acao === 'suspender' ? adicionarDias(dias || SUSPENSAO.DIAS_PADRAO) : null;

  const alteracao = {
    suspender: { status: 'suspenso', suspenso_ate: prazo, motivo_status: justificativa },
    banir: { status: 'banido', suspenso_ate: null, motivo_status: justificativa },
    restaurar: { status: 'ativo', suspenso_ate: null, motivo_status: null },
  }[acao];

  /* o alvo só muda quando faz sentido: restaurar quem já está ativo é ruído, e
     suspender quem já está banido seria abrandar a pena sem ninguém pedir */
  const alcance =
    acao === 'restaurar'
      ? { status: { [Op.in]: ['suspenso', 'banido'] } }
      : { status: { [Op.ne]: 'banido' } };

  const transacao = await db.sequelize.transaction();
  let aplicados = 0;

  try {
    /* bulk: um `UPDATE` para o lote inteiro, nunca um `save()` por conta */
    const [afetados] = await db.Usuario.update(alteracao, {
      where: { id: { [Op.in]: alvos }, ...alcance },
      transaction: transacao,
    });
    aplicados = afetados;

    if (definicao.derrubaSessao) {
      /* tirar acesso é derrubar sessão: sem isto o access token continua valendo
         por até 15 minutos e a sanção só existe no papel */
      await db.Sessao.update(
        {
          revogada_em: new Date(),
          revogada_motivo:
            acao === 'banir' ? MOTIVO_REVOGACAO.BANIMENTO : MOTIVO_REVOGACAO.SUSPENSAO,
        },
        { where: { usuario_id: { [Op.in]: alvos }, revogada_em: null }, transaction: transacao }
      );
    }

    await transacao.commit();
  } catch (erro) {
    await transacao.rollback();
    throw erro;
  }

  /* UMA linha para o lote inteiro, com a lista dos alvos (helper §registrarLote) */
  await registrarLote(contexto, {
    acao: definicao.auditoria,
    entidade: 'usuarios',
    ids: alvos,
    motivo: justificativa,
    resultado: { aplicados, suspensoAte: prazo },
  });

  /* avisos e desconexão fora do caminho da resposta: quarenta notificações em
     série fariam o Admin esperar pelo servidor de e-mail */
  if (definicao.derrubaSessao) {
    alvos.forEach((id) => {
      tempoReal.paraUsuario(id, tempoReal.EVENTOS.SESSAO_ENCERRADA, { motivo: justificativa });
    });
  }

  /* uma tarefa por afetado, mas nenhuma delas no caminho da resposta: a
     notificação é individual por natureza (cada pessoa recebe a sua), e o teto
     do lote garante que isto nunca passa de algumas dezenas de enfileiramentos */
  if (notificar !== false) {
    await Promise.all(
      alvos.map((id) =>
        filas.enfileirar('notificacao.criar', {
          usuarioId: id,
          tipo: acao === 'restaurar' ? 'sistema' : 'conta_suspensa',
          titulo: {
            suspender: 'Sua conta foi suspensa',
            banir: 'Sua conta foi banida',
            restaurar: 'Sua conta foi reativada',
          }[acao],
          mensagem: `Motivo: ${justificativa}`,
          dados: { motivo: justificativa, suspensoAte: prazo },
          entidade: 'usuarios',
          entidadeId: id,
          canais: ['sistema', 'email'],
        })
      )
    );
  }

  await invalidar();

  return { acao, solicitados: alvos.length, aplicados, ignorados: alvos.length - aplicados, suspensoAte: prazo };
}

module.exports = {
  editar,
  suspender,
  banir,
  restaurar,
  encerrarSessoes,
  sancionarEmLote,
  MAXIMO_LOTE,
};
