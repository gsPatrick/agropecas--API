'use strict';

const { PERMISSOES, CORINGA } = require('./permissoes');
const { PAPEIS, validar } = require('./papeis');

/**
 * Sincroniza o catálogo (código) com o banco. Idempotente: pode rodar a cada
 * deploy.
 *
 * O que ele NÃO faz: apagar papel criado pela Admin nem permissão que ela
 * concedeu manualmente. O catálogo é o piso, não o teto — a cliente pediu
 * flexibilidade, então o que ela montar na tela sobrevive ao deploy.
 *
 * Permissão que sai do código é marcada como obsoleta na saída, mas não é
 * removida: apagar permissão em uso derrubaria acesso em produção sem aviso.
 */
async function sincronizar(db, { silencioso = false } = {}) {
  const problemas = validar();
  if (problemas.length) {
    throw new Error(`Catálogo RBAC inconsistente:\n${problemas.join('\n')}`);
  }

  const log = (...args) => {
    if (!silencioso) console.log(...args);
  };

  const { Papel, Permissao, PapelPermissao, sequelize } = db;

  return sequelize.transaction(async (transaction) => {
    // ─── PERMISSÕES ──────────────────────────────────────────
    let criadasPermissoes = 0;

    for (const permissao of [
      { chave: CORINGA, recurso: '*', acao: '*', escopo: 'todos', descricao: 'Acesso total (Admin)' },
      ...PERMISSOES,
    ]) {
      const [, criada] = await Permissao.findOrCreate({
        where: { chave: permissao.chave },
        defaults: permissao,
        transaction,
      });
      if (criada) criadasPermissoes += 1;
    }

    const todasPermissoes = await Permissao.findAll({ transaction });
    const porChave = new Map(todasPermissoes.map((permissao) => [permissao.chave, permissao]));

    // ─── PAPÉIS ──────────────────────────────────────────────
    let criadosPapeis = 0;
    let vinculos = 0;

    for (const definicao of PAPEIS) {
      const [papel, criado] = await Papel.findOrCreate({
        where: { chave: definicao.chave },
        defaults: {
          chave: definicao.chave,
          nome: definicao.nome,
          descricao: definicao.descricao,
          sistema: definicao.sistema,
        },
        transaction,
      });
      if (criado) criadosPapeis += 1;

      for (const chave of definicao.permissoes) {
        const permissao = porChave.get(chave);
        if (!permissao) continue;

        const [, novo] = await PapelPermissao.findOrCreate({
          where: { papel_id: papel.id, permissao_id: permissao.id },
          defaults: { papel_id: papel.id, permissao_id: permissao.id },
          transaction,
        });
        if (novo) vinculos += 1;
      }
    }

    // ─── OBSOLETAS ───────────────────────────────────────────
    const doCodigo = new Set([CORINGA, ...PERMISSOES.map((permissao) => permissao.chave)]);
    const obsoletas = todasPermissoes
      .filter((permissao) => !doCodigo.has(permissao.chave))
      .map((permissao) => permissao.chave);

    log(
      `[rbac] permissões: ${PERMISSOES.length + 1} no catálogo (+${criadasPermissoes} novas) | ` +
        `papéis: ${PAPEIS.length} (+${criadosPapeis} novos) | vínculos novos: ${vinculos}`
    );

    if (obsoletas.length) {
      log(`[rbac] ⚠️ permissões no banco que saíram do código (não removidas): ${obsoletas.join(', ')}`);
    }

    return {
      permissoes: PERMISSOES.length + 1,
      papeis: PAPEIS.length,
      criadasPermissoes,
      criadosPapeis,
      vinculos,
      obsoletas,
    };
  });
}

module.exports = { sincronizar };
