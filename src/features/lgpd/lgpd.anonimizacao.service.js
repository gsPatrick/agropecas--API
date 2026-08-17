'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const config = require('../../config');
const filas = require('../../filas');
const senhaProvider = require('../../providers/senha');
const auditoria = require('../auditoria/auditoria.service');
const { erros } = require('../../utils/erros');
const { adicionarDias } = require('../../utils/datas');
const { exigir } = require('../../rbac');
const { MARCADOR, CONFIRMACAO_ANONIMIZACAO } = require('./lgpd.constants');

/**
 * Eliminação de dados (LGPD art. 18, VI) — que aqui é ANONIMIZAÇÃO, não
 * `DELETE`.
 *
 * O motivo está em `documentacao/models/LGPD.md` §2: apagar a linha do usuário
 * levaria junto anúncios e conversas em que a OUTRA parte tem interesse
 * legítimo — o comprador que negociou uma peça perderia o histórico da própria
 * negociação por uma decisão que não foi dele. E há dado que a lei manda
 * guardar (art. 16, I e II: obrigação legal e prova em processo).
 *
 * A regra que orienta cada linha abaixo: **o vínculo permanece, o
 * identificável some**. `usuarios.id` continua existindo e continua sendo
 * apontado por tudo; o que muda é que ele deixa de apontar para uma pessoa.
 *
 * É irreversível. Não há função de desfazer neste arquivo de propósito —
 * "restaurar" um usuário anonimizado só seria possível guardando em algum
 * lugar o dado que acabamos de prometer eliminar.
 */

/**
 * Pedido de anonimização. Só enfileira — a execução é do job, porque toca
 * sete tabelas e não pode morrer com o timeout da requisição.
 */
async function solicitar(dados, contexto) {
  const alvoId = dados.usuarioId || contexto.usuarioId;
  const proprio = String(alvoId) === String(contexto.usuarioId);

  /* conta alheia exige a capacidade específica; a própria basta o direito de
     remover a própria conta */
  if (proprio) exigir(contexto, 'usuario.remover', { donoId: alvoId });
  else exigir(contexto, 'usuario.anonimizar');

  if (dados.confirmacao !== CONFIRMACAO_ANONIMIZACAO) {
    throw erros.invalido(
      `Para confirmar, envie exatamente: "${CONFIRMACAO_ANONIMIZACAO}".`,
      { code: 'CONFIRMACAO_OBRIGATORIA' }
    );
  }

  const alvo = await db.Usuario.findByPk(alvoId);
  if (!alvo) throw erros.naoEncontrado('Usuário');
  if (alvo.anonimizado_em) throw erros.conflito('Esta conta já foi anonimizada.');

  /* o titular reautentica: um token roubado não pode apagar a conta da vítima.
     O Admin não precisa — ele já é outra pessoa agindo sobre a conta, e o que
     protege ali é a auditoria, não a senha */
  if (proprio) {
    const confere = alvo.senha_hash
      ? await senhaProvider.conferir(dados.senha, alvo.senha_hash)
      : await senhaProvider.conferirFalso(dados.senha);
    if (!confere) throw erros.naoAutenticado('Senha incorreta.', 'REAUTENTICACAO_FALHOU');
  }

  await auditoria.registrar(contexto, {
    acao: 'remover',
    entidade: 'usuario',
    entidadeId: alvoId,
    emNomeDe: proprio ? null : alvoId,
    motivo: dados.motivo || 'anonimização solicitada (LGPD art. 18, VI)',
    antes: { status: alvo.status, anonimizado: false },
    depois: { anonimizado: true },
  });

  if (!proprio) {
    await auditoria.registrarAcessoDado(contexto, {
      titularId: alvoId,
      recurso: 'cadastro',
      recursoId: alvoId,
      motivo: dados.motivo || 'anonimização a pedido do titular',
    });
  }

  await filas.enfileirar(
    'lgpd.anonimizar',
    { usuarioId: alvoId, solicitadoPor: contexto.usuarioId, motivo: dados.motivo || null },
    { chaveUnica: `lgpd:anonimizar:${alvoId}` }
  );

  return { usuarioId: alvoId, status: 'em_processamento', irreversivel: true };
}

/**
 * A execução. Uma transação só: uma conta meio anonimizada — perfil limpo mas
 * e-mail ainda no ar — é pior que nenhuma, porque a plataforma passa a afirmar
 * que atendeu o pedido enquanto o dado continua lá.
 */
async function executar(usuarioId, { motivo, solicitadoPor } = {}) {
  const usuario = await db.Usuario.findByPk(usuarioId);
  if (!usuario) return { anonimizado: false, motivo: 'usuario_inexistente' };
  if (usuario.anonimizado_em) return { anonimizado: false, motivo: 'ja_anonimizado' };

  const agora = new Date();
  const resumo = {};

  await db.sequelize.transaction(async (transacao) => {
    await usuario.update(
      {
        nome: MARCADOR.NOME,
        email: MARCADOR.EMAIL(usuario.id),
        email_normalizado: MARCADOR.EMAIL(usuario.id),
        senha_hash: null,
        telefone: null,
        whatsapp: null,
        status: 'removido',
        motivo_status: 'anonimizacao_lgpd',
        ultimo_login_ip_hash: null,
        observacoes_internas: null,
        anonimizado_em: agora,
        /* o registro sobrevive ao prazo de retenção porque ainda pode ser
           preciso em disputa (art. 16, II) — depois disso o job de expurgo
           finaliza */
        excluir_definitivamente_em: adicionarDias(config.lgpd.retencaoDias, agora),
      },
      { transaction: transacao }
    );

    const perfil = await db.Perfil.findOne({ where: { usuario_id: usuarioId }, transaction: transacao });

    if (perfil) {
      /* o endereço some antes do perfil para não deixar coordenada órfã
         apontando para a propriedade de quem pediu para sair */
      if (perfil.endereco_id) {
        await db.Endereco.update(
          {
            cep: null,
            logradouro: null,
            numero: null,
            complemento: null,
            bairro: null,
            referencia: null,
            latitude: null,
            longitude: null,
            precisao: 'aproximada',
          },
          { where: { id: perfil.endereco_id }, transaction: transacao }
        );
      }

      await perfil.update(
        {
          nome_exibicao: MARCADOR.PERFIL,
          /* o slug vira neutro: ele aparece na URL pública e costuma ser o
             nome da loja ou da propriedade */
          slug: MARCADOR.SLUG(usuario.id),
          documento: null,
          documento_tipo: null,
          razao_social: null,
          nome_fantasia: null,
          inscricao_estadual: null,
          bio: null,
          foto_url: null,
          capa_url: null,
          site: null,
          instagram: null,
          facebook: null,
          whatsapp: null,
          telefone_secundario: null,
          email_publico: null,
          exibir_whatsapp: false,
          exibir_endereco_exato: false,
          aceita_chat: false,
          propriedade_nome: null,
          verificacao_observacao: null,
        },
        { transaction: transacao }
      );
      resumo.perfil = true;
    }

    /* anúncios saem do ar mas NÃO são apagados: cada um pode ter conversa
       pendurada, e apagar quebraria a caixa de entrada do outro lado */
    const [anuncios] = await db.Anuncio.update(
      { status: 'removido' },
      { where: { usuario_id: usuarioId }, transaction: transacao }
    );
    resumo.anunciosOcultados = anuncios;

    /* favorito é preferência do titular e não interessa a ninguém mais */
    resumo.favoritosRemovidos = await db.Favorito.destroy({
      where: { usuario_id: usuarioId },
      transaction: transacao,
    });

    /* sessões e códigos pendentes morrem junto: manter sessão de conta
       anonimizada é manter acesso a uma conta que não tem mais dono */
    resumo.sessoesEncerradas = await db.Sessao.destroy({
      where: { usuario_id: usuarioId },
      transaction: transacao,
    });
    await db.TokenVerificacao.destroy({ where: { usuario_id: usuarioId }, transaction: transacao });

    /* preferência de notificação sem canal para onde enviar */
    await db.NotificacaoPreferencia.destroy({ where: { usuario_id: usuarioId }, transaction: transacao });

    /* notificações são avisos endereçados à pessoa: sem pessoa, viram lixo */
    await db.Notificacao.destroy({ where: { usuario_id: usuarioId }, transaction: transacao });

    /* mensagem é dado do titular só do lado que ELE escreveu — a conversa
       inteira não é apagada (quebraria a caixa de entrada de quem ficou),
       só o texto que saiu da própria pessoa. `remetente_id` continua
       apontando pro usuário anonimizado; o nome que aparece na tela já sai
       "Usuário removido" pelo update de perfil acima, sem precisar duplicar
       marcador aqui */
    const [mensagens] = await db.Mensagem.update(
      { conteudo: MARCADOR.MENSAGEM },
      { where: { remetente_id: usuarioId, conteudo: { [Op.ne]: null } }, transaction: transacao }
    );
    resumo.mensagensAnonimizadas = mensagens;

    /* mesma regra da mensagem: só o texto que a PRÓPRIA pessoa escreveu.
       Denúncia em que ela é a denunciada foi escrita por outra pessoa —
       apagar o relato de quem denunciou não é direito de quem foi denunciado */
    const [denuncias] = await db.Denuncia.update(
      { descricao: null, evidencia_url: null },
      { where: { denunciante_id: usuarioId }, transaction: transacao }
    );
    resumo.denunciasAnonimizadas = denuncias;
  });

  /* fora da transação: auditoria não pode desfazer junto num rollback, senão o
     rastro da tentativa se perde exatamente quando ela falhou */
  await auditoria.registrar(
    { usuarioId: solicitadoPor || null, origem: 'worker', papeis: [] },
    {
      acao: 'remover',
      entidade: 'usuario',
      entidadeId: usuarioId,
      motivo: motivo || 'anonimização executada (LGPD art. 18, VI)',
      depois: { anonimizadoEm: agora, retencaoDias: config.lgpd.retencaoDias, ...resumo },
    }
  );

  return { anonimizado: true, em: agora, ...resumo };
}

module.exports = { solicitar, executar };
