'use strict';

const db = require('../../models');
const registroService = require('./auth.registro.service');
const loginService = require('./auth.login.service');
const sessaoService = require('./auth.sessao.service');
const senhaService = require('./auth.senha.service');
const verificacaoService = require('./auth.verificacao.service');
const consentimentoService = require('./auth.consentimento.service');
const mapper = require('./auth.mapper');
const { montarContexto, exigir } = require('../../rbac');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');
const { erros } = require('../../utils/erros');
const { normalizarEmail } = require('../../utils/texto');
const { CONSENTIMENTOS_OBRIGATORIOS, CONSENTIMENTOS_OPCIONAIS } = require('./auth.constants');

/**
 * Controller — camada HTTP e **só ela**: lê a requisição, chama um service,
 * devolve. Nenhuma regra de negócio aqui; se aparecer um `if` decidindo o que
 * pode ou não, ele está no arquivo errado.
 *
 * Cada handler cabe na tela de propósito. É o que evita o "authController" de
 * 600 linhas onde ninguém acha o fluxo de OTP.
 */

/** o front manda checkboxes; a LGPD precisa de linhas tipadas */
function lerConsentimentos(corpo) {
  const itens = [];

  if (corpo.aceiteTermos) itens.push({ tipo: 'termos_de_uso', aceito: true });
  if (corpo.aceitePrivacidade) itens.push({ tipo: 'politica_privacidade', aceito: true });

  CONSENTIMENTOS_OPCIONAIS.forEach((tipo) => {
    if (corpo[tipo] !== undefined) itens.push({ tipo, aceito: Boolean(corpo[tipo]) });
  });

  /* o formulário pode mandar a lista pronta; a versão do checkbox é atalho */
  if (Array.isArray(corpo.consentimentos)) itens.push(...corpo.consentimentos);

  return itens.filter(
    (item, indice, lista) => lista.findIndex((outro) => outro.tipo === item.tipo) === indice
  );
}

/** papéis e permissões que o front usa para montar o menu */
async function credenciais(usuarioId) {
  const usuario = await db.Usuario.findByPk(usuarioId, {
    include: [
      {
        model: db.Papel,
        as: 'papeis',
        through: { attributes: [] },
        include: [{ model: db.Permissao, as: 'permissoes', through: { attributes: [] } }],
      },
    ],
  });

  const ctx = montarContexto(usuario);
  return { papeis: ctx.papeis, permissoes: [...ctx.permissoes] };
}

const registrar = catchAsync(async (req, res) => {
  const { usuario, perfil, tokens } = await registroService.criar(
    { ...req.body, consentimentos: lerConsentimentos(req.body) },
    req.contexto
  );

  const { papeis, permissoes } = await credenciais(usuario.id);

  resposta.criado(res, mapper.sessaoCompleta({ usuario, perfil, tokens, papeis, permissoes }), {
    mensagem: 'Conta criada. Enviamos um código para confirmar seu e-mail.',
  });
});

const entrar = catchAsync(async (req, res) => {
  const { usuario, tokens } = await loginService.entrar(req.body, req.contexto);

  /* inclui o município para o mapper devolver o nome, não só o uuid — sem
     isso o painel mostra a cidade em branco mesmo com o perfil preenchido */
  const perfil = await db.Perfil.findOne({
    where: { usuario_id: usuario.id },
    include: [{ model: db.Municipio, as: 'municipio', attributes: ['id', 'nome', 'uf'] }],
  });
  const { papeis, permissoes } = await credenciais(usuario.id);

  resposta.ok(res, mapper.sessaoCompleta({ usuario, perfil, tokens, papeis, permissoes }));
});

const renovar = catchAsync(async (req, res) => {
  const refresh = req.body.refreshToken || req.cookies?.refreshToken;
  const { usuario, tokens } = await sessaoService.renovar(refresh, req.contexto);

  resposta.ok(res, { usuario: mapper.usuario(usuario), tokens });
});

const sair = catchAsync(async (req, res) => {
  await sessaoService.encerrar(req.contexto.sessaoId);
  resposta.semConteudo(res);
});

const sairDeTodos = catchAsync(async (req, res) => {
  const manterAtual = req.body.manterAtual !== false;
  const total = await sessaoService.encerrarTodas(req.contexto.usuarioId, {
    exceto: manterAtual ? req.contexto.sessaoId : null,
  });

  resposta.ok(res, { encerradas: total });
});

const eu = catchAsync(async (req, res) => {
  const perfil = await db.Perfil.findOne({
    where: { usuario_id: req.contexto.usuarioId },
    include: [{ model: db.Municipio, as: 'municipio', attributes: ['id', 'nome', 'uf'] }],
  });
  await sessaoService.tocar(req.contexto.sessaoId);

  resposta.ok(res, {
    usuario: mapper.usuario(req.contexto.usuario),
    perfil: mapper.perfil(perfil),
    papeis: req.contexto.papeis,
    permissoes: [...req.contexto.permissoes],
    admin: req.contexto.admin,
  });
});

const listarSessoes = catchAsync(async (req, res) => {
  const sessoes = await sessaoService.listar(req.contexto.usuarioId);
  resposta.ok(
    res,
    sessoes.map((item) => mapper.sessao(item, { atual: req.contexto.sessaoId }))
  );
});

const encerrarSessao = catchAsync(async (req, res) => {
  const alvo = await db.Sessao.findByPk(req.params.id);
  if (!alvo) throw erros.naoEncontrado('Sessão');

  /* escopo só pode ser conferido depois de saber de quem é a sessão: o dono
     encerra as próprias, o Admin encerra a de qualquer um */
  exigir(req.contexto, 'usuario.encerrar_sessoes', { donoId: alvo.usuario_id });

  const encerrada = await sessaoService.encerrar(alvo.id);
  resposta.ok(res, { encerrada });
});

const solicitarSenha = catchAsync(async (req, res) => {
  const dados = await senhaService.solicitar(req.body, req.contexto);
  resposta.ok(res, dados, {
    mensagem: 'Se este e-mail estiver cadastrado, você receberá um código.',
  });
});

const conferirCodigoSenha = catchAsync(async (req, res) => {
  resposta.ok(res, await senhaService.conferirCodigo(req.body));
});

const redefinirSenha = catchAsync(async (req, res) => {
  resposta.ok(res, await senhaService.redefinir(req.body, req.contexto), {
    mensagem: 'Senha alterada. Entre com a nova senha.',
  });
});

const trocarSenha = catchAsync(async (req, res) => {
  resposta.ok(res, await senhaService.trocar(req.contexto, req.body), {
    mensagem: 'Senha alterada com sucesso.',
  });
});

const confirmarEmail = catchAsync(async (req, res) => {
  const usuario = await verificacaoService.porEmail(normalizarEmail(req.body.email));
  if (!usuario) return resposta.ok(res, { confirmado: false });

  await verificacaoService.confirmar({ usuario, codigo: req.body.codigo });
  resposta.ok(res, { confirmado: true, usuario: mapper.usuario(usuario) });
});

const reenviarCodigo = catchAsync(async (req, res) => {
  const usuario = await verificacaoService.porEmail(normalizarEmail(req.body.email));

  /* mesma resposta com ou sem conta: o endpoint não confirma cadastro */
  if (usuario && !usuario.email_verificado_em) {
    await verificacaoService.enviarCodigo(usuario, req.contexto).catch(() => null);
  }

  resposta.ok(res, { enviado: true }, { mensagem: 'Se houver pendência, o código foi reenviado.' });
});

const listarConsentimentos = catchAsync(async (req, res) => {
  const itens = await consentimentoService.listar(req.contexto.usuarioId);
  resposta.ok(res, itens.map(mapper.consentimento));
});

const atualizarConsentimento = catchAsync(async (req, res) => {
  const { tipo, aceito } = req.body;

  const itens = aceito
    ? await consentimentoService.registrar(
        req.contexto.usuarioId,
        [{ tipo, aceito: true }],
        req.contexto,
        { origem: 'perfil' }
      )
    : await consentimentoService.revogar(req.contexto.usuarioId, tipo, req.contexto);

  resposta.ok(res, itens.map(mapper.consentimento));
});

module.exports = {
  registrar,
  entrar,
  renovar,
  sair,
  sairDeTodos,
  eu,
  listarSessoes,
  encerrarSessao,
  solicitarSenha,
  conferirCodigoSenha,
  redefinirSenha,
  trocarSenha,
  confirmarEmail,
  reenviarCodigo,
  listarConsentimentos,
  atualizarConsentimento,
  CONSENTIMENTOS_OBRIGATORIOS,
};
