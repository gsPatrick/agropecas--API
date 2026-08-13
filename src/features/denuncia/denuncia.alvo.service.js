'use strict';

const db = require('../../models');
const { erros } = require('../../utils/erros');

/**
 * Resolve o alvo de uma denúncia: ele existe? de quem é?
 *
 * Existe como service próprio porque é a única parte da feature que conhece as
 * outras tabelas. A denúncia é genérica de propósito (uma tabela para todos os
 * alvos, ver `models/denuncia.js`), e sem este arquivo a genericidade viraria
 * um `switch` repetido na criação e de novo na resolução.
 *
 * Saber o DONO do alvo é o que permite as duas regras do módulo: bloquear a
 * auto-denúncia e apontar a moderação para a pessoa certa.
 *
 * `conversa` é o único alvo sem dono único — são dois participantes. Fica com
 * `donoId` nulo e a apuração acontece pela conversa, não pela pessoa.
 */

const RESOLVEDORES = {
  anuncio: async (id) => {
    const registro = await db.Anuncio.findByPk(id, { attributes: ['id', 'usuario_id'] });
    return registro && { donoId: registro.usuario_id };
  },

  perfil: async (id) => {
    const registro = await db.Perfil.findByPk(id, { attributes: ['id', 'usuario_id'] });
    return registro && { donoId: registro.usuario_id };
  },

  mensagem: async (id) => {
    const registro = await db.Mensagem.findByPk(id, { attributes: ['id', 'remetente_id'] });
    /* mensagem do sistema tem remetente nulo — denunciá-la não aponta ninguém */
    return registro && { donoId: registro.remetente_id };
  },

  conversa: async (id) => {
    const registro = await db.Conversa.findByPk(id, { attributes: ['id'] });
    return registro && { donoId: null };
  },
};

/**
 * @returns {{ donoId: string|null }}
 * @throws 404 quando o alvo não existe — o mesmo 404 de "não encontrei",
 *         nunca um erro diferente que confirmasse a existência do registro
 */
async function resolver(alvoTipo, alvoId) {
  const resolvedor = RESOLVEDORES[alvoTipo];
  if (!resolvedor) throw erros.invalido('Tipo de alvo não suportado.');

  const alvo = await resolvedor(alvoId);
  if (!alvo) throw erros.naoEncontrado('Registro denunciado');

  return alvo;
}

module.exports = { resolver, RESOLVEDORES };
