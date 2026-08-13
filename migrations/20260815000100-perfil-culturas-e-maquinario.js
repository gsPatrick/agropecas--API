'use strict';

/**
 * Culturas e maquinário do produtor.
 *
 * A tela `/painel/propriedade` já coletava as duas coisas e não tinha onde
 * gravar — o formulário salvava em memória e o dado sumia no refresh.
 *
 * Três tabelas:
 *  · `culturas`         — vocabulário fechado (o porquê está em models/cultura.js)
 *  · `perfil_culturas`  — pivô, no padrão de `perfil_servicos`
 *  · `perfil_maquinas`  — frota da propriedade, com marca do catálogo OU texto
 *                         livre (regra de produto: implemento de fabricante
 *                         pequeno precisa entrar)
 *
 * A definição das colunas vem dos models, como na migration de schema
 * completo: duplicar aqui à mão garantiria divergência na primeira alteração.
 */

const { randomUUID } = require('crypto');
const db = require('../src/models');
const { normalizar } = require('../src/utils/texto');

const NOVAS = ['Cultura', 'PerfilCultura', 'PerfilMaquina'];

/** converte os atributos do model no formato aceito por createTable */
function atributosDe(model) {
  const saida = {};

  Object.entries(model.rawAttributes).forEach(([nome, def]) => {
    saida[def.field || nome] = {
      type: def.type,
      allowNull: def.allowNull !== false,
      primaryKey: def.primaryKey || false,
      defaultValue: def.defaultValue,
      unique: def.unique || false,
      references: def.references,
      onUpdate: def.references ? 'CASCADE' : undefined,
      onDelete: def.references ? 'SET NULL' : undefined,
      comment: def.comment,
    };
  });

  return saida;
}

/**
 * Vocabulário inicial. É o mesmo que a tela do produtor já mostrava (o front
 * carregava a lista de um mock), agora do lado do servidor — senão a primeira
 * pessoa a salvar receberia "cultura inválida" numa lista que a própria
 * plataforma exibiu.
 *
 * Ordem = ordem de importância em MT, não alfabética: soja e milho respondem
 * pela maioria absoluta da área plantada e precisam estar nos primeiros
 * cliques.
 */
const CULTURAS = [
  ['Soja', 'soja', 'lavoura'],
  ['Milho', 'milho', 'lavoura'],
  ['Milho safrinha', 'milho-safrinha', 'lavoura'],
  ['Algodão', 'algodao', 'lavoura'],
  ['Feijão', 'feijao', 'lavoura'],
  ['Sorgo', 'sorgo', 'lavoura'],
  ['Girassol', 'girassol', 'lavoura'],
  ['Cana-de-açúcar', 'cana-de-acucar', 'lavoura'],
  ['Pastagem', 'pastagem', 'pecuaria'],
  ['Gado de corte', 'gado-de-corte', 'pecuaria'],
  ['Gado de leite', 'gado-de-leite', 'pecuaria'],
];

module.exports = {
  async up(queryInterface) {
    const sql = (texto, opcoes) => queryInterface.sequelize.query(texto, opcoes);

    for (const nome of NOVAS) {
      const model = db[nome];
      if (!model) throw new Error(`Model ausente: ${nome}`);
      await queryInterface.createTable(model.tableName, atributosDe(model));
    }

    for (const nome of NOVAS) {
      const model = db[nome];
      for (const indice of model.options.indexes || []) {
        await queryInterface.addIndex(model.tableName, indice.fields, {
          unique: indice.unique || false,
          name: indice.name || `idx_${model.tableName}_${indice.fields.join('_')}`.slice(0, 63),
        });
      }
    }

    /* nome único ignorando cultura removida — mesmo raciocínio do e-mail em
       `usuarios`: apagar "Sorgo" não pode bloquear o nome para sempre */
    await sql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_culturas_nome_ativo
      ON culturas (nome_normalizado) WHERE removido_em IS NULL;
    `);

    /* ano de fabricação fora de faixa é erro de digitação, não dado: o teto
       aberto deixaria "20188" passar e quebrar a ordenação da frota */
    await sql(`
      ALTER TABLE perfil_maquinas
      ADD CONSTRAINT ck_perfil_maquinas_ano
      CHECK (ano IS NULL OR (ano >= 1950 AND ano <= 2100));
    `);

    /* marca só por texto é permitido; marca vazia não — sem nome a linha não
       diz nada a ninguém */
    await sql(`
      ALTER TABLE perfil_maquinas
      ADD CONSTRAINT ck_perfil_maquinas_marca_nome
      CHECK (length(btrim(marca_nome)) > 0);
    `);

    /* apagar o perfil leva junto frota e culturas: são dados que só existem em
       função dele, e órfãos aqui virariam contagem errada na busca. O padrão
       gerado por `references` seria SET NULL, que a coluna NOT NULL recusa */
    for (const [tabela, coluna] of [
      ['perfil_culturas', 'perfil_id'],
      ['perfil_maquinas', 'perfil_id'],
    ]) {
      await sql(`
        ALTER TABLE ${tabela}
        DROP CONSTRAINT IF EXISTS ${tabela}_${coluna}_fkey,
        ADD CONSTRAINT ${tabela}_${coluna}_fkey
        FOREIGN KEY (${coluna}) REFERENCES perfis (id) ON UPDATE CASCADE ON DELETE CASCADE;
      `);
    }

    await sql(`
      ALTER TABLE perfil_culturas
      DROP CONSTRAINT IF EXISTS perfil_culturas_cultura_id_fkey,
      ADD CONSTRAINT perfil_culturas_cultura_id_fkey
      FOREIGN KEY (cultura_id) REFERENCES culturas (id) ON UPDATE CASCADE ON DELETE CASCADE;
    `);

    // ─── vocabulário inicial ───────────────────────────────────
    const agora = new Date();

    await queryInterface.bulkInsert(
      'culturas',
      CULTURAS.map(([nome, slug, grupo], indice) => ({
        id: randomUUID(),
        nome,
        nome_normalizado: normalizar(nome),
        slug,
        grupo,
        ordem: indice + 1,
        ativo: true,
        total_produtores: 0,
        criado_em: agora,
        atualizado_em: agora,
      })),
      {}
    );
  },

  async down(queryInterface) {
    for (const nome of [...NOVAS].reverse()) {
      await queryInterface.dropTable(db[nome].tableName, { cascade: true });
    }

    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS enum_culturas_grupo CASCADE;
      DROP TYPE IF EXISTS enum_perfil_maquinas_tipo CASCADE;
    `);
  },
};
