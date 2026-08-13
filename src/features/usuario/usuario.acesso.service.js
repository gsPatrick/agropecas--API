'use strict';

const db = require('../../models');
const { RECURSO_ACESSO } = require('./usuario.constants');

/**
 * Registro de LEITURA de dado pessoal de terceiro (LGPD).
 *
 * Auditoria de alteração não cobre isto: quando um moderador abre a ficha de
 * alguém, nada mudou no banco — e é justamente a leitura que gera o risco.
 * `documentacao/models/LGPD.md` §2 chama isso de "leitura também é evento".
 *
 * Duas decisões:
 *   1. **Só terceiro.** O titular abrindo a própria conta não gera linha; se
 *      gerasse, a tabela viraria log de tráfego e o que importa (um Admin
 *      abrindo cadastro alheio) sumiria no meio.
 *   2. **Nunca derruba a operação**, como em `auditoria.service.js`. Um log
 *      perdido é ruim; negar suporte ao usuário porque o log falhou é pior.
 */
async function registrarLeitura(contexto, { titularId, recurso = RECURSO_ACESSO.CADASTRO, recursoId, motivo }) {
  if (!contexto?.usuarioId) return;
  if (String(contexto.usuarioId) === String(titularId)) return;

  try {
    await db.LogAcessoDado.create({
      ator_id: contexto.usuarioId,
      titular_id: titularId,
      recurso,
      recurso_id: recursoId || titularId,
      motivo: motivo || null,
      ip_hash: contexto.ipHash || null,
      user_agent: contexto.userAgent || null,
    });
  } catch (erro) {
    console.error('[usuario] falha ao registrar acesso a dado pessoal', {
      titularId,
      mensagem: erro.message,
    });
  }
}

/**
 * Versão em lote, para a listagem: uma página de 20 cadastros não pode virar
 * 20 INSERTs em sequência no caminho da resposta.
 */
async function registrarLeituraEmLote(contexto, titularIds, { motivo } = {}) {
  const alvos = (titularIds || []).filter((id) => String(id) !== String(contexto?.usuarioId));
  if (!contexto?.usuarioId || !alvos.length) return;

  try {
    await db.LogAcessoDado.bulkCreate(
      alvos.map((titularId) => ({
        ator_id: contexto.usuarioId,
        titular_id: titularId,
        recurso: RECURSO_ACESSO.CADASTRO,
        recurso_id: titularId,
        motivo: motivo || 'listagem de usuários',
        ip_hash: contexto.ipHash || null,
        user_agent: contexto.userAgent || null,
      }))
    );
  } catch (erro) {
    console.error('[usuario] falha ao registrar acesso em lote', erro.message);
  }
}

module.exports = { registrarLeitura, registrarLeituraEmLote };
