'use strict';

const jwtProvider = require('../providers/jwt');
const { montarContexto } = require('../rbac');
const { erros } = require('../utils/erros');
const catchAsync = require('../utils/catch-async');

/**
 * Autenticação. Deliberadamente dividido em três exports, porque "estar
 * logado" não é uma condição só:
 *
 *   autenticar  → exige token válido (401 sem ele)
 *   opcional    → aceita token, segue sem ele (rota pública que muda de
 *                 conteúdo para quem está logado — favorito marcado, botão
 *                 "conversar" no anúncio)
 *   exigirVerificado → além de logado, e-mail confirmado
 *
 * Papéis e permissões são lidos do BANCO a cada requisição, nunca do token.
 * Permissão que vive dentro do JWT só muda quando o token expira — a Admin
 * revogaria um acesso e ele continuaria valendo por 15 minutos.
 */

function lerToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.token || null;
}

/** carrega usuário + papéis + permissões e injeta tudo em req.contexto */
async function carregar(req, token) {
  const db = require('../models');
  const payload = jwtProvider.verificar(token);

  const usuario = await db.Usuario.findByPk(payload.sub, {
    include: [
      {
        model: db.Papel,
        as: 'papeis',
        through: { attributes: [] },
        include: [{ model: db.Permissao, as: 'permissoes', through: { attributes: [] } }],
      },
    ],
  });

  if (!usuario) throw erros.naoAutenticado('Conta não encontrada.', 'USUARIO_INEXISTENTE');
  if (usuario.status === 'banido') {
    throw erros.contaBloqueada('Esta conta foi banida da plataforma.');
  }
  if (usuario.status === 'suspenso') {
    throw erros.contaBloqueada('Esta conta está suspensa. Fale com o suporte.');
  }

  /* access token nasce vinculado a uma sessão. Token sem `sid` não é
     emitido por este sistema — aceitar um seria criar um acesso que nenhum
     logout alcança, porque não há o que revogar */
  if (!payload.sid) {
    throw erros.naoAutenticado('Sessão inválida. Entre novamente.', 'SESSAO_INVALIDA');
  }

  const sessao = await db.Sessao.findByPk(payload.sid);

  if (!sessao || sessao.revogada_em) {
    throw erros.naoAutenticado('Sessão encerrada. Entre novamente.', 'SESSAO_REVOGADA');
  }

  /* a sessão precisa ser DESTE usuário: um token que aponte para a sessão de
     outra pessoa é sinal de adulteração, não de erro */
  if (String(sessao.usuario_id) !== String(usuario.id)) {
    throw erros.naoAutenticado('Sessão inválida. Entre novamente.', 'SESSAO_INVALIDA');
  }

  if (new Date(sessao.expira_em) <= new Date()) {
    throw erros.naoAutenticado('Sessão expirada. Entre novamente.', 'SESSAO_EXPIRADA');
  }

  req.contexto.sessaoId = sessao.id;

  Object.assign(req.contexto, montarContexto(usuario), {
    usuario,
    usuarioId: usuario.id,
    autenticado: true,
  });
}

const autenticar = catchAsync(async (req, res, next) => {
  const token = lerToken(req);
  if (!token) throw erros.naoAutenticado('Entre para continuar.', 'TOKEN_AUSENTE');
  await carregar(req, token);
  next();
});

const opcional = catchAsync(async (req, res, next) => {
  const token = lerToken(req);
  if (!token) return next();

  /* token ruim numa rota pública não é erro do usuário: trata como visitante
     em vez de quebrar a página inteira por causa de um token velho */
  try {
    await carregar(req, token);
  } catch (erro) {
    if (erro.statusCode === 423) throw erro; // conta banida/suspensa: barrar mesmo
  }
  next();
});

const exigirVerificado = (req, res, next) => {
  if (!req.contexto.autenticado) {
    return next(erros.naoAutenticado('Entre para continuar.', 'TOKEN_AUSENTE'));
  }
  if (!req.contexto.usuario.email_verificado_em && !req.contexto.admin) {
    return next(
      erros.semPermissao('Confirme seu e-mail para usar esta função.', 'EMAIL_NAO_VERIFICADO')
    );
  }
  next();
};

module.exports = autenticar;
module.exports.autenticar = autenticar;
module.exports.opcional = opcional;
module.exports.exigirVerificado = exigirVerificado;
