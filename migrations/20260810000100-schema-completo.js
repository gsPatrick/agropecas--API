'use strict';

/**
 * Schema completo — cria as 49 tabelas do sistema.
 *
 * A definição vem dos models (única fonte de verdade): duplicar 49 tabelas à
 * mão garantiria divergência entre migration e model na primeira alteração.
 * O que os models NÃO expressam — índice parcial, índice de similaridade,
 * constraint de valor e regra de exclusão em cascata — está explícito no fim
 * deste arquivo.
 *
 * A ordem de criação respeita as dependências: tabela só nasce depois de tudo
 * a que ela referencia.
 */

const db = require('../src/models');

const ORDEM = [
  // ── referência e configuração (sem dependência)
  'Estado',
  'Municipio',
  'Configuracao',
  'DocumentoLegal',
  'Papel',
  'Permissao',
  'PapelPermissao',
  'Plano',
  'PlanoLimite',
  'Marca',
  'Maquina',

  // ── identidade
  'Endereco',
  'Usuario',
  'UsuarioPapel',
  'Sessao',
  'TokenVerificacao',
  'TentativaLogin',
  'Arquivo',

  // ── catálogo dependente
  'Categoria',
  'Servico',

  // ── perfis e apoio
  'Perfil',
  'PerfilHorario',
  'PerfilServico',
  'PerfilMarca',
  'PerfilAreaAtendimento',

  // ── anúncios
  'Anuncio',
  'AnuncioFoto',
  'AnuncioAtributo',
  'AnuncioMaquina',
  'AnuncioHistorico',
  'AnuncioMetricaDiaria',
  'Favorito',

  // ── conversas
  'Conversa',
  'ConversaParticipante',
  'Mensagem',
  'AnuncioContato',
  'BloqueioUsuario',

  // ── moderação e avisos
  'Denuncia',
  'TemplateNotificacao',
  'Notificacao',
  'NotificacaoPreferencia',

  // ── LGPD e auditoria
  'Consentimento',
  'SolicitacaoTitular',
  'LogAuditoria',
  'LogAcessoDado',

  // ── produto e planos
  'BuscaLog',
  'TermoPopular',
  'Assinatura',
  'UsoMedido',
];

/** converte os atributos do model no formato aceito por createTable */
function atributosDe(model) {
  const attrs = model.rawAttributes;
  const saida = {};

  Object.entries(attrs).forEach(([nome, def]) => {
    saida[def.field || nome] = {
      type: def.type,
      allowNull: def.allowNull !== false ? true : false,
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

module.exports = {
  async up(queryInterface) {
    // ─── TABELAS ───────────────────────────────────────────────
    for (const nome of ORDEM) {
      const model = db[nome];
      if (!model) throw new Error(`Model ausente na ordem de criação: ${nome}`);
      await queryInterface.createTable(model.tableName, atributosDe(model));
    }

    // ─── ÍNDICES DECLARADOS NOS MODELS ─────────────────────────
    for (const nome of ORDEM) {
      const model = db[nome];
      const indices = model.options.indexes || [];

      for (const indice of indices) {
        await queryInterface.addIndex(model.tableName, indice.fields, {
          unique: indice.unique || false,
          name:
            indice.name ||
            `idx_${model.tableName}_${indice.fields.join('_')}`.slice(0, 63),
        });
      }
    }

    const sql = (texto) => queryInterface.sequelize.query(texto);

    // ─── ÍNDICES QUE O SEQUELIZE NÃO EXPRESSA ──────────────────

    /* documento é único só quando informado: dois perfis sem CPF não podem
       colidir entre si */
    await sql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_perfis_documento
      ON perfis (documento) WHERE documento IS NOT NULL AND removido_em IS NULL;
    `);

    /* e-mail único ignorando conta removida — senão o titular que excluiu a
       conta bloqueia o próprio e-mail para sempre */
    await sql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_email_ativo
      ON usuarios (email_normalizado) WHERE removido_em IS NULL;
    `);

    /* busca por similaridade: "rolamentu" precisa encontrar "rolamento" */
    await sql(`
      CREATE INDEX IF NOT EXISTS idx_anuncios_busca_trgm
      ON anuncios USING gin (busca_texto gin_trgm_ops);
    `);
    await sql(`
      CREATE INDEX IF NOT EXISTS idx_anuncios_titulo_trgm
      ON anuncios USING gin (titulo_normalizado gin_trgm_ops);
    `);
    await sql(`
      CREATE INDEX IF NOT EXISTS idx_municipios_nome_trgm
      ON municipios USING gin (nome_normalizado gin_trgm_ops);
    `);
    await sql(`
      CREATE INDEX IF NOT EXISTS idx_maquinas_modelo_trgm
      ON maquinas USING gin (modelo_normalizado gin_trgm_ops);
    `);

    /* a listagem pública sempre filtra por status + data: índice composto
       parcial evita varrer anúncio removido e rascunho */
    await sql(`
      CREATE INDEX IF NOT EXISTS idx_anuncios_vitrine
      ON anuncios (status, publicado_em DESC)
      WHERE removido_em IS NULL AND status = 'publicado';
    `);

    /* contador do chat: "minhas conversas com não lidas" é a consulta que roda
       a cada carregamento de página */
    await sql(`
      CREATE INDEX IF NOT EXISTS idx_participantes_nao_lidas
      ON conversa_participantes (usuario_id) WHERE nao_lidas > 0;
    `);

    // ─── REGRAS DE VALOR ───────────────────────────────────────
    await sql(`
      ALTER TABLE anuncios
      ADD CONSTRAINT ck_anuncios_preco_nao_negativo
      CHECK (preco_centavos IS NULL OR preco_centavos >= 0);
    `);
    await sql(`
      ALTER TABLE anuncios
      ADD CONSTRAINT ck_anuncios_preco_ou_combinar
      CHECK (preco_centavos IS NOT NULL OR preco_a_combinar = true);
    `);
    await sql(`
      ALTER TABLE conversas
      ADD CONSTRAINT ck_conversas_partes_distintas
      CHECK (anunciante_id <> interessado_id);
    `);
    await sql(`
      ALTER TABLE bloqueios_usuario
      ADD CONSTRAINT ck_bloqueio_nao_autobloqueio
      CHECK (usuario_id <> bloqueado_id);
    `);
    await sql(`
      ALTER TABLE perfil_horarios
      ADD CONSTRAINT ck_horario_coerente
      CHECK (fechado = true OR (abre_as IS NOT NULL AND fecha_as IS NOT NULL));
    `);

    /* dado do titular não pode sumir por efeito colateral: apagar usuário
       levaria junto o histórico da outra parte na conversa */
    await sql(`
      ALTER TABLE anuncios
      DROP CONSTRAINT IF EXISTS anuncios_usuario_id_fkey,
      ADD CONSTRAINT anuncios_usuario_id_fkey
      FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON UPDATE CASCADE ON DELETE RESTRICT;
    `);
    await sql(`
      ALTER TABLE mensagens
      DROP CONSTRAINT IF EXISTS mensagens_conversa_id_fkey,
      ADD CONSTRAINT mensagens_conversa_id_fkey
      FOREIGN KEY (conversa_id) REFERENCES conversas (id) ON UPDATE CASCADE ON DELETE CASCADE;
    `);
    await sql(`
      ALTER TABLE anuncio_fotos
      DROP CONSTRAINT IF EXISTS anuncio_fotos_anuncio_id_fkey,
      ADD CONSTRAINT anuncio_fotos_anuncio_id_fkey
      FOREIGN KEY (anuncio_id) REFERENCES anuncios (id) ON UPDATE CASCADE ON DELETE CASCADE;
    `);
    await sql(`
      ALTER TABLE anuncio_atributos
      DROP CONSTRAINT IF EXISTS anuncio_atributos_anuncio_id_fkey,
      ADD CONSTRAINT anuncio_atributos_anuncio_id_fkey
      FOREIGN KEY (anuncio_id) REFERENCES anuncios (id) ON UPDATE CASCADE ON DELETE CASCADE;
    `);
    await sql(`
      ALTER TABLE favoritos
      DROP CONSTRAINT IF EXISTS favoritos_anuncio_id_fkey,
      ADD CONSTRAINT favoritos_anuncio_id_fkey
      FOREIGN KEY (anuncio_id) REFERENCES anuncios (id) ON UPDATE CASCADE ON DELETE CASCADE;
    `);
  },

  async down(queryInterface) {
    for (const nome of [...ORDEM].reverse()) {
      await queryInterface.dropTable(db[nome].tableName, { cascade: true });
    }

    // enums criados pelo Postgres a partir dos ENUM do Sequelize
    await queryInterface.sequelize.query(`
      DO $$
      DECLARE t record;
      BEGIN
        FOR t IN SELECT typname FROM pg_type WHERE typname LIKE 'enum_%' LOOP
          EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(t.typname) || ' CASCADE';
        END LOOP;
      END $$;
    `);
  },
};
