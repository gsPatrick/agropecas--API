'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const config = require('../../config');
const { erros } = require('../../utils/erros');
const { gerarCodigoNumerico, hashToken, compararSeguro } = require('../../utils/hash');
const { adicionarMinutos } = require('../../utils/datas');

/**
 * Códigos de uso único (verificação de e-mail, recuperação de senha, OTP).
 *
 * Um service só para isto porque os três fluxos usam exatamente a mesma
 * mecânica — emitir, conferir, consumir — e duplicá-la em cada um seria
 * garantir que o dia da correção só um dos três fosse corrigido.
 *
 * O código nunca é guardado em claro: quem lê a tabela não consegue entrar na
 * conta de ninguém.
 */

/** invalida os anteriores e emite um novo — código velho não deve continuar valendo */
async function emitir({ usuarioId, tipo, destino, minutos, contexto }) {
  await db.TokenVerificacao.update(
    { invalidado_em: new Date() },
    { where: { usuario_id: usuarioId, tipo, usado_em: null, invalidado_em: null } }
  );

  const codigo = gerarCodigoNumerico(config.auth.otpDigitos);

  const registro = await db.TokenVerificacao.create({
    usuario_id: usuarioId,
    tipo,
    codigo_hash: hashToken(codigo),
    destino,
    expira_em: adicionarMinutos(minutos || config.auth.otpMinutos),
    max_tentativas: 5,
    ip_hash: contexto?.ipHash || null,
    user_agent: contexto?.userAgent || null,
  });

  /* o código em claro sai daqui uma única vez, para o provider de e-mail */
  return { codigo, registro };
}

/**
 * Confere sem consumir. Erra de forma genérica de propósito: distinguir
 * "código errado" de "código expirado" ajuda mais quem está tentando adivinhar
 * do que quem esqueceu.
 */
async function conferir({ usuarioId, tipo, codigo }) {
  const registro = await db.TokenVerificacao.findOne({
    where: {
      usuario_id: usuarioId,
      tipo,
      usado_em: null,
      invalidado_em: null,
      expira_em: { [Op.gt]: new Date() },
    },
    order: [['criado_em', 'DESC']],
  });

  if (!registro) throw erros.invalido('Código inválido ou expirado.', { code: 'CODIGO_INVALIDO' });

  if (registro.tentativas >= registro.max_tentativas) {
    await registro.update({ invalidado_em: new Date() });
    throw erros.muitasTentativas('Código bloqueado por excesso de tentativas. Solicite um novo.');
  }

  if (!compararSeguro(hashToken(String(codigo)), registro.codigo_hash)) {
    await registro.increment('tentativas');
    throw erros.invalido('Código inválido ou expirado.', { code: 'CODIGO_INVALIDO' });
  }

  return registro;
}

/** marca como usado — separado de `conferir` para permitir validar sem gastar */
const consumir = (registro) => registro.update({ usado_em: new Date() });

/** confere e consome na mesma chamada (o caso comum) */
async function validar({ usuarioId, tipo, codigo }) {
  const registro = await conferir({ usuarioId, tipo, codigo });
  await consumir(registro);
  return registro;
}

module.exports = { emitir, conferir, consumir, validar };
