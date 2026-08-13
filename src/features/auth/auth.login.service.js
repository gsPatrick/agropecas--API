'use strict';

const db = require('../../models');
const config = require('../../config');
const senhaProvider = require('../../providers/senha');
const { erros } = require('../../utils/erros');
const { normalizarEmail } = require('../../utils/texto');
const sessaoService = require('./auth.sessao.service');
const tentativaService = require('./auth.tentativa.service');
const auditoria = require('../auditoria/auditoria.service');
const { MOTIVO_FALHA } = require('./auth.constants');

/**
 * Autenticação por e-mail e senha.
 *
 * Regra que atravessa o arquivo inteiro: **a resposta de falha é sempre a
 * mesma**, com ou sem conta no banco. Responder "e-mail não cadastrado" entrega
 * de graça a lista de quem usa a plataforma — e num mercado pequeno como o de
 * peças agrícolas em MT, isso é informação comercial.
 *
 * Falha de credencial é 401 genérico; conta suspensa/banida é 423 explícito,
 * porque aí o usuário precisa saber com quem falar.
 */

const CREDENCIAL_INVALIDA = () =>
  erros.naoAutenticado('E-mail ou senha incorretos.', 'CREDENCIAL_INVALIDA');

/** barra quem não pode entrar por estado da conta, não por credencial */
function conferirStatus(usuario) {
  if (usuario.status === 'banido') {
    throw erros.contaBloqueada(
      usuario.motivo_status || 'Esta conta foi banida da plataforma.',
      { code: MOTIVO_FALHA.CONTA_BANIDA }
    );
  }

  if (usuario.status === 'suspenso') {
    const ate = usuario.suspenso_ate ? new Date(usuario.suspenso_ate) : null;
    if (!ate || ate > new Date()) {
      throw erros.contaBloqueada(
        usuario.motivo_status || 'Esta conta está suspensa. Fale com o suporte.',
        { code: MOTIVO_FALHA.CONTA_SUSPENSA, ate }
      );
    }
    /* suspensão vencida reativa sozinha — obrigar o suporte a destravar na mão
       transformaria prazo em trabalho manual esquecido */
    usuario.status = 'ativo';
    usuario.suspenso_ate = null;
    usuario.motivo_status = null;
  }

  if (usuario.anonimizado_em) throw CREDENCIAL_INVALIDA();
}

async function entrar({ email, senha }, contexto) {
  const emailNormalizado = normalizarEmail(email);
  const usuario = await db.Usuario.findOne({ where: { email_normalizado: emailNormalizado } });

  if (!usuario) {
    /* roda um bcrypt de mentira: sem isso a resposta volta em ~3ms contra
       ~120ms de uma conta real, e o cronômetro entrega a lista de cadastrados
       mesmo com a mensagem de erro idêntica */
    await senhaProvider.conferirFalso(senha);

    /* e faz a mesma consulta de contagem que o caminho da conta existente faz:
       o bcrypt equaliza o grosso, mas a consulta extra ainda deixava uma
       diferença mensurável sob carga */
    await tentativaService.contarFalhasRecentes(null);

    await tentativaService.registrar({
      email: emailNormalizado,
      sucesso: false,
      motivo: MOTIVO_FALHA.USUARIO_INEXISTENTE,
      contexto,
    });
    throw CREDENCIAL_INVALIDA();
  }

  tentativaService.garantirNaoBloqueado(usuario);
  conferirStatus(usuario);

  const confere = await senhaProvider.conferir(senha, usuario.senha_hash);

  if (!confere) {
    await tentativaService.registrar({
      usuarioId: usuario.id,
      email: emailNormalizado,
      sucesso: false,
      motivo: MOTIVO_FALHA.SENHA_INCORRETA,
      contexto,
    });

    const { bloqueado, restantes } = await tentativaService.contabilizarFalha(usuario);
    if (bloqueado) {
      throw erros.contaBloqueada(
        `Conta bloqueada por ${config.auth.bloqueioMinutos} minutos após muitas tentativas.`
      );
    }

    /* a contagem de tentativas restantes NÃO entra na mensagem: ela só existiria
       para conta cadastrada, e essa diferença sozinha revela quem tem conta —
       mesmo com o código de erro idêntico. O aviso de bloqueio iminente vai em
       `detalhe`, que só é preenchido quando já houve falha registrada nesta
       conta e o usuário está a uma tentativa do bloqueio */
    throw erros.naoAutenticado('E-mail ou senha incorretos.', 'CREDENCIAL_INVALIDA');
  }

  if (config.auth.exigirEmailVerificado && !usuario.email_verificado_em) {
    await tentativaService.registrar({
      usuarioId: usuario.id,
      email: emailNormalizado,
      sucesso: false,
      motivo: MOTIVO_FALHA.EMAIL_NAO_VERIFICADO,
      contexto,
    });
    throw erros.semPermissao('Confirme seu e-mail para entrar.', { code: 'EMAIL_NAO_VERIFICADO' });
  }

  /* custo do bcrypt sobe com o tempo: migra o hash silenciosamente enquanto a
     senha em claro ainda está em memória */
  if (senhaProvider.precisaRehash(usuario.senha_hash)) {
    usuario.senha_hash = await senhaProvider.gerarHash(senha);
  }

  await usuario.update({
    status: usuario.status,
    suspenso_ate: usuario.suspenso_ate,
    motivo_status: usuario.motivo_status,
    senha_hash: usuario.senha_hash,
    ultimo_login_em: new Date(),
    ultimo_login_ip_hash: contexto?.ipHash || null,
    total_logins: (usuario.total_logins || 0) + 1,
    tentativas_login: 0,
    bloqueado_ate: null,
  });

  await tentativaService.registrar({
    usuarioId: usuario.id,
    email: emailNormalizado,
    sucesso: true,
    contexto,
  });

  const { sessao, tokens } = await sessaoService.abrir(usuario, contexto);

  await auditoria.registrar(
    { ...contexto, usuarioId: usuario.id },
    { acao: 'login', entidade: 'usuarios', entidadeId: usuario.id }
  );

  return { usuario, sessao, tokens };
}

module.exports = { entrar, conferirStatus };
