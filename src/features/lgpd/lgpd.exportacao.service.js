'use strict';

const db = require('../../models');
const filas = require('../../filas');
const senhaProvider = require('../../providers/senha');
const tokenService = require('../auth/auth.token.service');
const auditoria = require('../auditoria/auditoria.service');
const { RECURSO_ACESSO } = require('../auditoria/auditoria.constants');
const { erros } = require('../../utils/erros');
const { adicionarDias } = require('../../utils/datas');
const { exigir } = require('../../rbac');
const { PRAZO_RESPOSTA_DIAS, TOKEN_CONFIRMACAO, TOKEN_CONFIRMACAO_MINUTOS } = require('./lgpd.constants');

/**
 * Portabilidade (LGPD art. 18, V): o pacote com tudo que o sistema guarda
 * sobre uma pessoa.
 *
 * Este é o endpoint mais perigoso da API. Ele entrega, num arquivo só, o que
 * um atacante levaria semanas raspando: cadastro, documento, endereço,
 * conversas, favoritos. Por isso **um token de acesso válido não basta** —
 * exige a senha (reautenticação) e um código enviado ao e-mail cadastrado.
 * Sessão roubada não vira export sem que a vítima receba o código.
 *
 * A montagem do pacote NÃO acontece aqui: é trabalho de fila
 * (`lgpd.exportarDados`). Gerar dezenas de consultas no caminho da resposta
 * seguraria um worker HTTP por minutos e daria timeout no cliente justamente
 * nas contas maiores, que são as que mais precisam.
 */

/**
 * Passo 1 — reautenticar e enviar o código.
 *
 * A senha é conferida mesmo quando o usuário acabou de entrar: o intervalo
 * entre "entrei" e "peço tudo sobre mim" é exatamente a janela que um token
 * roubado aproveita.
 */
async function solicitar(contexto, { senha }) {
  exigir(contexto, 'usuario.exportar_dados', { donoId: contexto.usuarioId });

  const usuario = await db.Usuario.findByPk(contexto.usuarioId);
  if (!usuario) throw erros.naoEncontrado('Usuário');

  const confere = usuario.senha_hash
    ? await senhaProvider.conferir(senha, usuario.senha_hash)
    : await senhaProvider.conferirFalso(senha);

  if (!confere) {
    /* 401 e não 422: não é campo mal preenchido, é credencial recusada */
    throw erros.naoAutenticado('Senha incorreta.', 'REAUTENTICACAO_FALHOU');
  }

  const { codigo } = await tokenService.emitir({
    usuarioId: usuario.id,
    tipo: TOKEN_CONFIRMACAO,
    destino: usuario.email,
    minutos: TOKEN_CONFIRMACAO_MINUTOS,
    contexto,
  });

  await filas
    .enfileirar('email.enviar', {
      para: usuario.email,
      assunto: 'Código para exportar seus dados — AgroPeças MT',
      texto:
        `Olá, ${usuario.nome.split(' ')[0]}!\n\n` +
        `Seu código para liberar a exportação dos seus dados é ${codigo}.\n` +
        `Ele vale por ${TOKEN_CONFIRMACAO_MINUTOS} minutos.\n\n` +
        `Se não foi você quem pediu, ignore este e-mail e troque sua senha: ` +
        `alguém com acesso à sua conta tentou baixar todos os seus dados.`,
    })
    .catch(() => null);

  return { confirmacaoEnviada: true, expiraEmMinutos: TOKEN_CONFIRMACAO_MINUTOS };
}

/**
 * Passo 2 — confirmar o código e enfileirar.
 *
 * Cria a solicitação de titular junto: portabilidade é direito do art. 18, e
 * ter o protocolo registrado é o que permite provar depois que foi atendida
 * dentro do prazo.
 */
async function confirmar(contexto, { codigo }) {
  exigir(contexto, 'usuario.exportar_dados', { donoId: contexto.usuarioId });

  await tokenService.validar({
    usuarioId: contexto.usuarioId,
    tipo: TOKEN_CONFIRMACAO,
    codigo,
  });

  const solicitacao = await db.SolicitacaoTitular.create({
    usuario_id: contexto.usuarioId,
    email_solicitante: contexto.usuario?.email,
    tipo: 'portabilidade',
    status: 'em_atendimento',
    descricao: 'Exportação de dados solicitada pelo titular na plataforma.',
    identidade_verificada_em: new Date(),
    prazo_em: adicionarDias(PRAZO_RESPOSTA_DIAS),
    ip_hash: contexto.ipHash || null,
  });

  await auditoria.registrar(contexto, {
    acao: 'exportar_dados',
    entidade: 'usuario',
    entidadeId: contexto.usuarioId,
    motivo: 'exportação de dados pelo titular (LGPD art. 18, V)',
    depois: { solicitacaoId: solicitacao.id },
  });

  await filas.enfileirar(
    'lgpd.exportarDados',
    { usuarioId: contexto.usuarioId, solicitacaoId: solicitacao.id },
    /* chave única: dois cliques no botão não geram dois pacotes completos */
    { chaveUnica: `lgpd:export:${contexto.usuarioId}` }
  );

  return { solicitacaoId: solicitacao.id, status: 'em_processamento' };
}

/**
 * Exportação pedida pelo ENCARREGADO em nome do titular (atendimento manual de
 * um pedido que chegou por outro canal). Exige escopo `todos` e deixa dois
 * rastros: a alteração e a leitura de dado de terceiro.
 */
async function solicitarParaTitular(contexto, { usuarioId, motivo }) {
  exigir(contexto, 'usuario.exportar_dados', { donoId: usuarioId });

  if (String(usuarioId) === String(contexto.usuarioId)) {
    throw erros.invalido('Para exportar seus próprios dados, use o fluxo com confirmação.');
  }

  const titular = await db.Usuario.findByPk(usuarioId, { attributes: ['id', 'email'] });
  if (!titular) throw erros.naoEncontrado('Usuário');

  await auditoria.registrar(contexto, {
    acao: 'exportar_dados',
    entidade: 'usuario',
    entidadeId: usuarioId,
    emNomeDe: usuarioId,
    motivo: motivo || 'atendimento de solicitação de titular',
  });

  await auditoria.registrarAcessoDado(contexto, {
    titularId: usuarioId,
    recurso: RECURSO_ACESSO.EXPORTACAO,
    recursoId: usuarioId,
    motivo: motivo || 'atendimento de solicitação de titular',
  });

  await filas.enfileirar(
    'lgpd.exportarDados',
    { usuarioId, solicitadoPor: contexto.usuarioId },
    { chaveUnica: `lgpd:export:${usuarioId}` }
  );

  return { usuarioId, status: 'em_processamento' };
}

module.exports = { solicitar, confirmar, solicitarParaTitular };
