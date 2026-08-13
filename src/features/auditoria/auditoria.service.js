'use strict';

const db = require('../../models');
const { mascarar } = require('./auditoria.mascara');

/**
 * Registro de auditoria — usado por TODAS as features, não só por esta.
 *
 * Fica num service próprio porque auditar é obrigação transversal: RBAC dá
 * poder amplo ao Admin, e poder amplo sem rastro é exatamente o que a LGPD
 * cobra. Ver `documentacao/RBAC.md` §2.
 *
 * Falha de auditoria NUNCA derruba a operação de negócio: um log perdido é
 * ruim, mas impedir o usuário de entrar porque o log falhou é pior. A falha
 * vai para o console e o time investiga.
 *
 * Duas funções, dois fatos diferentes — não confunda:
 *
 *   registrar()            → alguém MUDOU alguma coisa
 *   registrarAcessoDado()  → alguém LEU dado pessoal de terceiro
 *
 * O contrato completo de `registrarAcessoDado` está em
 * `documentacao/features/Auditoria.md`.
 */

/**
 * Grava uma ação na trilha imutável.
 *
 * ⚠️ ASSINATURA CONGELADA: onze módulos já chamam esta função. Mudar a forma
 * dos parâmetros quebra todos de uma vez, e o sintoma é silencioso (o catch
 * engole). Campo novo entra como propriedade opcional do segundo argumento.
 *
 * `antes`/`depois` passam por `mascarar()` antes de ir para o banco — quem
 * chama pode mandar o registro inteiro sem virar vazamento. Ver
 * `auditoria.mascara.js` para o porquê.
 */
async function registrar(contexto, { acao, entidade, entidadeId, antes, depois, motivo, emNomeDe }) {
  try {
    await db.LogAuditoria.create({
      ator_id: contexto?.usuarioId || null,
      ator_papel: (contexto?.papeis || [])[0] || null,
      em_nome_de: emNomeDe || null,
      acao,
      entidade,
      entidade_id: entidadeId || null,
      antes: mascarar(antes) || null,
      depois: mascarar(depois) || null,
      motivo: motivo || null,
      ip_hash: contexto?.ipHash || null,
      user_agent: contexto?.userAgent || null,
      origem: contexto?.origem || 'web',
    });
  } catch (erro) {
    console.error('[auditoria] falha ao registrar', { acao, entidade, mensagem: erro.message });
  }
}

/**
 * Registra LEITURA de dado pessoal de terceiro (LGPD — prestação de contas).
 *
 * Chame **sempre que** um Admin ou moderador abrir dado de alguém que não é
 * ele: cadastro completo, documento, conversa, endereço exato, telefone. A
 * auditoria de alteração não cobre isto — e é justamente a leitura que gera o
 * risco, porque não deixa nenhum outro rastro no sistema.
 *
 * ```js
 * const auditoria = require('../auditoria');
 *
 * await auditoria.registrarAcessoDado(ctx, {
 *   titularId: usuario.id,
 *   recurso: auditoria.RECURSO_ACESSO.CONVERSA,
 *   recursoId: conversa.id,
 *   motivo: 'análise de denúncia',
 *   denunciaId: denuncia.id,
 * });
 * ```
 *
 * Regras do contrato:
 *
 * 1. **Não lança nunca.** Igual a `registrar`: log perdido é ruim, negar a
 *    operação porque o log falhou é pior.
 * 2. **Não grave acesso ao próprio dado.** A função ignora
 *    `titularId === contexto.usuarioId` sozinha — o titular lendo os próprios
 *    dados não é evento de privacidade, e registrar isso enterraria os acessos
 *    que importam num mar de ruído.
 * 3. **`recurso` vem de `RECURSO_ACESSO`.** String livre torna o relatório ao
 *    titular incomparável entre si.
 * 4. **`motivo` é o que salva a empresa.** "análise de denúncia #123" é
 *    defensável; acesso sem motivo declarado, não.
 * 5. **Não substitui `registrar`.** Se além de ler houve mudança, chame as duas.
 *
 * @returns {Promise<boolean>} gravou? (informativo — ninguém precisa conferir)
 */
async function registrarAcessoDado(
  contexto,
  { titularId, recurso, recursoId, motivo, denunciaId } = {}
) {
  try {
    if (!contexto?.usuarioId || !recurso) return false;

    /* ler o próprio dado não é acesso de terceiro — ver regra 2 do contrato */
    if (titularId && String(titularId) === String(contexto.usuarioId)) return false;

    await db.LogAcessoDado.create({
      ator_id: contexto.usuarioId,
      titular_id: titularId || null,
      recurso,
      recurso_id: recursoId || null,
      motivo: motivo ? String(motivo).slice(0, 255) : null,
      denuncia_id: denunciaId || null,
      ip_hash: contexto.ipHash || null,
      user_agent: contexto.userAgent || null,
    });

    return true;
  } catch (erro) {
    console.error('[auditoria] falha ao registrar acesso a dado', {
      recurso,
      mensagem: erro.message,
    });
    return false;
  }
}

/**
 * Versão em lote para quando um Admin abre uma LISTA com dado de várias
 * pessoas. Uma linha por titular, num `bulkCreate` — o laço com `create`
 * dentro transformaria a abertura de uma tela em N inserts.
 */
async function registrarAcessoEmLote(contexto, { titularIds = [], recurso, motivo } = {}) {
  try {
    if (!contexto?.usuarioId || !recurso) return 0;

    const alvos = [...new Set(titularIds.filter(Boolean).map(String))].filter(
      (id) => id !== String(contexto.usuarioId)
    );
    if (!alvos.length) return 0;

    const linhas = alvos.map((titularId) => ({
      ator_id: contexto.usuarioId,
      titular_id: titularId,
      recurso,
      motivo: motivo ? String(motivo).slice(0, 255) : null,
      ip_hash: contexto.ipHash || null,
      user_agent: contexto.userAgent || null,
    }));

    await db.LogAcessoDado.bulkCreate(linhas);
    return linhas.length;
  } catch (erro) {
    console.error('[auditoria] falha ao registrar acesso em lote', { recurso, mensagem: erro.message });
    return 0;
  }
}

module.exports = { registrar, registrarAcessoDado, registrarAcessoEmLote };
