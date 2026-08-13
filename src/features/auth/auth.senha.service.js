'use strict';

const db = require('../../models');
const config = require('../../config');
const senhaProvider = require('../../providers/senha');
const filas = require('../../filas');
const { erros } = require('../../utils/erros');
const { normalizarEmail, mascararEmail } = require('../../utils/texto');
const tokenService = require('./auth.token.service');
const sessaoService = require('./auth.sessao.service');
const auditoria = require('../auditoria/auditoria.service');
const { MOTIVO_REVOGACAO } = require('./auth.constants');

/**
 * Recuperação e troca de senha.
 *
 * Dois princípios:
 *   1. **Não confirmar existência de conta.** `solicitar` responde igual para
 *      e-mail cadastrado e não cadastrado — senão o endpoint vira consulta de
 *      base de clientes.
 *   2. **Trocar senha derruba as sessões.** É o gesto que a pessoa faz quando
 *      desconfia de invasão; manter o invasor logado esvaziaria o remédio.
 */

/** passo 1 — envia o código; resposta é sempre a mesma */
async function solicitar({ email: destinatario }, contexto) {
  const emailNormalizado = normalizarEmail(destinatario);
  const usuario = await db.Usuario.findOne({ where: { email_normalizado: emailNormalizado } });

  const resposta = {
    enviado: true,
    destino: mascararEmail(destinatario),
    expiraEmMinutos: config.auth.otpMinutos,
  };

  if (!usuario || usuario.anonimizado_em || usuario.status === 'banido') return resposta;

  const { codigo } = await tokenService.emitir({
    usuarioId: usuario.id,
    tipo: 'recuperacao_senha',
    destino: usuario.email,
    minutos: config.auth.otpMinutos,
    contexto,
  });

  await filas.enfileirar('email.enviar', {
    para: usuario.email,
    modelo: 'recuperacao_senha',
    dados: {
      nome: usuario.nome.split(' ')[0],
      codigo,
      link: `${config.app.webUrl}/entrar/nova-senha?email=${encodeURIComponent(usuario.email)}&codigo=${codigo}`,
    },
  });

  return resposta;
}

/**
 * passo 2 — confere o código SEM consumir.
 * O front precisa validar o OTP antes de mostrar o formulário de nova senha;
 * consumir aqui faria o código morrer entre uma tela e outra.
 */
async function conferirCodigo({ email: destinatario, codigo }) {
  const usuario = await db.Usuario.findOne({
    where: { email_normalizado: normalizarEmail(destinatario) },
  });
  if (!usuario) throw erros.invalido('Código inválido ou expirado.', { code: 'CODIGO_INVALIDO' });

  await tokenService.conferir({ usuarioId: usuario.id, tipo: 'recuperacao_senha', codigo });
  return { valido: true };
}

/** passo 3 — consome o código e grava a nova senha */
async function redefinir({ email: destinatario, codigo, senha }, contexto) {
  const usuario = await db.Usuario.findOne({
    where: { email_normalizado: normalizarEmail(destinatario) },
  });
  if (!usuario) throw erros.invalido('Código inválido ou expirado.', { code: 'CODIGO_INVALIDO' });

  await tokenService.validar({ usuarioId: usuario.id, tipo: 'recuperacao_senha', codigo });

  await aplicar(usuario, senha, MOTIVO_REVOGACAO.RECUPERACAO_SENHA, contexto);
  return { alterada: true };
}

/** troca com a senha atual (usuário logado) */
async function trocar(contexto, { senhaAtual, senha }) {
  const usuario = contexto.usuario;

  const confere = await senhaProvider.conferir(senhaAtual, usuario.senha_hash);
  if (!confere) {
    throw erros.validacao({ senhaAtual: 'A senha atual está incorreta.' });
  }

  if (await senhaProvider.conferir(senha, usuario.senha_hash)) {
    throw erros.validacao({ senha: 'A nova senha precisa ser diferente da atual.' });
  }

  /* mantém a sessão atual: quem trocou a senha voluntariamente não deve ser
     expulso da própria tela */
  await aplicar(usuario, senha, MOTIVO_REVOGACAO.TROCA_SENHA, contexto, {
    manterSessao: contexto.sessaoId,
  });
  return { alterada: true };
}

/** caminho único de escrita — os três fluxos acima convergem aqui */
async function aplicar(usuario, novaSenha, motivo, contexto, { manterSessao } = {}) {
  await usuario.update({
    senha_hash: await senhaProvider.gerarHash(novaSenha),
    senha_alterada_em: new Date(),
    tentativas_login: 0,
    bloqueado_ate: null,
  });

  await sessaoService.encerrarTodas(usuario.id, { exceto: manterSessao, motivo });

  /* aviso de senha alterada é sinal de segurança: se não foi o dono, é assim
     que ele descobre. Vai na frente da fila */
  await filas.enfileirar(
    'email.enviar',
    { para: usuario.email, modelo: 'senha_alterada', dados: { nome: usuario.nome.split(' ')[0] } },
    { prioridade: 1 }
  );

  await auditoria.registrar(
    { ...contexto, usuarioId: usuario.id },
    { acao: 'editar', entidade: 'usuarios', entidadeId: usuario.id, motivo }
  );
}

module.exports = { solicitar, conferirCodigo, redefinir, trocar };
