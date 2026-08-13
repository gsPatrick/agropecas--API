'use strict';

/**
 * Revoga três permissões administrativas que vazaram para o papel `usuario`.
 *
 * Causa: `propriasDoRecurso()` entregava ao usuário comum toda ação **sem
 * escopo** do recurso. Isso está certo para `anuncio.criar` (todo mundo
 * publica) e era desastroso para:
 *
 *   usuario.criar                 — criar contas manualmente
 *   notificacao.template_editar   — reescrever o texto dos avisos do sistema
 *   lgpd.publicar_documento       — publicar uma nova versão dos Termos de Uso
 *
 * O código já foi corrigido (marca `administrativa: true` em `recursos.js`),
 * mas o sincronizador de RBAC **nunca apaga vínculo** — por segurança, para não
 * derrubar acesso concedido à mão pela Admin. Então a revogação do que já foi
 * gravado precisa ser explícita, e é isto aqui.
 *
 * Só remove o vínculo do papel `usuario`. As permissões continuam existindo e
 * o Admin segue com todas pelo coringa.
 */

const CHAVES = ['usuario.criar', 'notificacao.template_editar', 'lgpd.publicar_documento'];

module.exports = {
  async up(queryInterface) {
    const [linhas] = await queryInterface.sequelize.query(
      `
      DELETE FROM papel_permissoes pp
      USING papeis p, permissoes perm
      WHERE pp.papel_id = p.id
        AND pp.permissao_id = perm.id
        AND p.chave = 'usuario'
        AND perm.chave IN (:chaves)
      RETURNING pp.id;
      `,
      { replacements: { chaves: CHAVES } }
    );

    console.log(`[rbac] ${linhas.length} permissão(ões) administrativa(s) revogada(s) do papel usuario`);
  },

  async down() {
    /* sem volta: reconceder privilégio administrativo a todo cadastro é
       exatamente o defeito que esta migration existe para corrigir */
  },
};
