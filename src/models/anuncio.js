'use strict';

const {
  ANUNCIO_TIPO,
  ANUNCIO_STATUS,
  ANUNCIO_CONDICAO,
  ANUNCIO_NEGOCIACAO,
  MODERACAO_STATUS,
  PRECISAO_LOCALIZACAO,
} = require('./constantes');

/**
 * Anuncio — a ENTIDADE CENTRAL do sistema (Maturacao/05, §7.1).
 *
 * Todo perfil anuncia: o produtor publica peça que sobra, a loja publica
 * estoque, o prestador publica serviço. O `tipo` diferencia — inclusive
 * `procura`, para quem precisa de algo e não achou.
 *
 * Preço em CENTAVOS (inteiro). Decimal em dinheiro acumula erro de
 * arredondamento e não existe motivo para aceitar isso.
 *
 * Localização é desnormalizada (municipio_id, uf, lat, lng) além do endereco_id:
 * a busca por região é a consulta mais frequente do produto e não pode
 * depender de join em toda listagem.
 */
module.exports = (sequelize, DataTypes) => {
  const Anuncio = sequelize.define(
    'Anuncio',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      codigo: {
        type: DataTypes.STRING(12),
        allowNull: false,
        unique: true,
        comment: 'código curto público (AGP-7F3K) — usado na conversa e no suporte',
      },

      usuario_id: { type: DataTypes.UUID, allowNull: false },
      perfil_id: { type: DataTypes.UUID, allowNull: false },

      tipo: { type: DataTypes.ENUM(...ANUNCIO_TIPO), allowNull: false, defaultValue: 'peca' },
      categoria_id: { type: DataTypes.UUID, allowNull: true },
      marca_id: { type: DataTypes.UUID, allowNull: true },

      titulo: { type: DataTypes.STRING(160), allowNull: false },
      titulo_normalizado: {
        type: DataTypes.STRING(160),
        allowNull: false,
        comment: 'sem acento e minúsculo — a busca do usuário nunca vem acentuada',
      },
      slug: { type: DataTypes.STRING(200), allowNull: false, unique: true },
      descricao: { type: DataTypes.TEXT, allowNull: false },

      condicao: {
        type: DataTypes.ENUM(...ANUNCIO_CONDICAO),
        allowNull: false,
        defaultValue: 'nao_se_aplica',
      },
      negociacao: {
        type: DataTypes.ENUM(...ANUNCIO_NEGOCIACAO),
        allowNull: false,
        defaultValue: 'venda',
      },

      preco_centavos: { type: DataTypes.BIGINT, allowNull: true },
      preco_a_combinar: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      aceita_troca: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      moeda: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'BRL' },

      quantidade: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 1 },
      unidade: { type: DataTypes.STRING(20), allowNull: true, defaultValue: 'unidade' },
      codigo_peca: { type: DataTypes.STRING(60), allowNull: true, comment: 'part number do fabricante' },
      codigo_peca_normalizado: { type: DataTypes.STRING(60), allowNull: true },

      aceita_entrega: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      entrega_observacao: { type: DataTypes.STRING(255), allowNull: true },
      atende_no_local: { type: DataTypes.BOOLEAN, allowNull: true, comment: 'serviços' },

      endereco_id: { type: DataTypes.UUID, allowNull: true },
      municipio_id: { type: DataTypes.UUID, allowNull: true },
      uf: { type: DataTypes.STRING(2), allowNull: true },
      latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
      longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
      precisao_localizacao: {
        type: DataTypes.ENUM(...PRECISAO_LOCALIZACAO),
        allowNull: false,
        defaultValue: 'aproximada',
      },

      status: { type: DataTypes.ENUM(...ANUNCIO_STATUS), allowNull: false, defaultValue: 'rascunho' },
      moderacao_status: {
        type: DataTypes.ENUM(...MODERACAO_STATUS),
        allowNull: false,
        defaultValue: 'nao_revisado',
      },
      moderado_por: { type: DataTypes.UUID, allowNull: true },
      moderado_em: { type: DataTypes.DATE, allowNull: true },
      moderacao_motivo: { type: DataTypes.TEXT, allowNull: true },

      publicado_em: { type: DataTypes.DATE, allowNull: true },
      expira_em: { type: DataTypes.DATE, allowNull: true },
      renovado_em: { type: DataTypes.DATE, allowNull: true },
      total_renovacoes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      destaque_ate: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'preparado para planos pagos — hoje sempre nulo',
      },

      total_visualizacoes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total_contatos_whatsapp: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total_contatos_chat: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total_favoritos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total_denuncias: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      criado_por_admin: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Admin pode publicar em nome de terceiro (Maturacao/05, §2.4)',
      },
      criado_por_admin_id: { type: DataTypes.UUID, allowNull: true },

      seo_titulo: { type: DataTypes.STRING(180), allowNull: true },
      seo_descricao: { type: DataTypes.STRING(300), allowNull: true },
      busca_texto: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'título + descrição + marca + código, normalizado — base do índice full text',
      },
    },
    {
      tableName: 'anuncios',
      paranoid: true,
      indexes: [
        { unique: true, fields: ['codigo'] },
        { unique: true, fields: ['slug'] },
        { fields: ['usuario_id'] },
        { fields: ['perfil_id'] },
        { fields: ['categoria_id'] },
        { fields: ['marca_id'] },
        { fields: ['status', 'publicado_em'] },
        { fields: ['municipio_id', 'status'] },
        { fields: ['uf', 'status'] },
        { fields: ['tipo', 'status'] },
        { fields: ['preco_centavos'] },
        { fields: ['expira_em'] },
      ],
    }
  );

  Anuncio.associate = (models) => {
    Anuncio.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
    Anuncio.belongsTo(models.Perfil, { foreignKey: 'perfil_id', as: 'perfil' });
    Anuncio.belongsTo(models.Categoria, { foreignKey: 'categoria_id', as: 'categoria' });
    Anuncio.belongsTo(models.Marca, { foreignKey: 'marca_id', as: 'marca' });
    Anuncio.belongsTo(models.Endereco, { foreignKey: 'endereco_id', as: 'endereco' });
    Anuncio.belongsTo(models.Municipio, { foreignKey: 'municipio_id', as: 'municipio' });

    Anuncio.hasMany(models.AnuncioFoto, { foreignKey: 'anuncio_id', as: 'fotos' });
    Anuncio.hasMany(models.AnuncioAtributo, { foreignKey: 'anuncio_id', as: 'atributos' });
    Anuncio.hasMany(models.AnuncioHistorico, { foreignKey: 'anuncio_id', as: 'historico' });
    Anuncio.hasMany(models.AnuncioMetricaDiaria, { foreignKey: 'anuncio_id', as: 'metricas' });
    Anuncio.hasMany(models.Favorito, { foreignKey: 'anuncio_id', as: 'favoritos' });
    Anuncio.hasMany(models.Conversa, { foreignKey: 'anuncio_id', as: 'conversas' });

    Anuncio.belongsToMany(models.Maquina, {
      through: models.AnuncioMaquina,
      foreignKey: 'anuncio_id',
      otherKey: 'maquina_id',
      as: 'maquinasCompativeis',
    });
  };

  return Anuncio;
};
