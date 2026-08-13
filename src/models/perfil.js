'use strict';

const { PERFIL_TIPO, PESSOA_TIPO, DOCUMENTO_TIPO } = require('./constantes');

/**
 * Perfil — o rosto público do usuário: Produtor Rural, Loja de Peças ou
 * Prestador de Serviços (Maturacao/05).
 *
 * Loja e Prestador não são tabelas separadas: são o MESMO perfil com um
 * discriminador. O que muda entre eles são campos opcionais e as tabelas de
 * apoio (serviços, marcas, horários) — não a estrutura.
 *
 * LGPD: documento (CPF/CNPJ) é dado sensível de identificação; guardar só
 * dígitos, nunca expor na API pública e registrar acesso do Admin.
 */
module.exports = (sequelize, DataTypes) => {
  const Perfil = sequelize.define(
    'Perfil',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      usuario_id: { type: DataTypes.UUID, allowNull: false, unique: true },

      tipo: { type: DataTypes.ENUM(...PERFIL_TIPO), allowNull: false },
      slug: { type: DataTypes.STRING(160), allowNull: false, unique: true },

      nome_exibicao: { type: DataTypes.STRING(160), allowNull: false },
      pessoa_tipo: { type: DataTypes.ENUM(...PESSOA_TIPO), allowNull: false, defaultValue: 'fisica' },
      documento_tipo: { type: DataTypes.ENUM(...DOCUMENTO_TIPO), allowNull: true },
      documento: {
        type: DataTypes.STRING(14),
        allowNull: true,
        comment: 'somente dígitos; único quando informado',
      },
      razao_social: { type: DataTypes.STRING(180), allowNull: true },
      nome_fantasia: { type: DataTypes.STRING(180), allowNull: true },
      inscricao_estadual: { type: DataTypes.STRING(30), allowNull: true },

      bio: { type: DataTypes.TEXT, allowNull: true },
      foto_url: { type: DataTypes.STRING(500), allowNull: true },
      capa_url: { type: DataTypes.STRING(500), allowNull: true },
      site: { type: DataTypes.STRING(255), allowNull: true },
      instagram: { type: DataTypes.STRING(120), allowNull: true },
      facebook: { type: DataTypes.STRING(120), allowNull: true },

      whatsapp: { type: DataTypes.STRING(20), allowNull: true, comment: 'E.164' },
      telefone_secundario: { type: DataTypes.STRING(20), allowNull: true },
      email_publico: { type: DataTypes.STRING(180), allowNull: true },

      exibir_whatsapp: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'LGPD: consentimento espelhado da tabela consentimentos',
      },
      exibir_endereco_exato: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'produtor costuma anunciar de casa — padrão é localização aproximada',
      },
      aceita_chat: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      endereco_id: { type: DataTypes.UUID, allowNull: true },
      municipio_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'desnormalizado do endereço para filtro de busca sem join',
      },
      uf: { type: DataTypes.STRING(2), allowNull: true },

      propriedade_nome: { type: DataTypes.STRING(160), allowNull: true, comment: 'produtor' },
      area_hectares: { type: DataTypes.DECIMAL(12, 2), allowNull: true, comment: 'produtor' },
      atende_no_campo: { type: DataTypes.BOOLEAN, allowNull: true, comment: 'prestador' },
      raio_atendimento_km: { type: DataTypes.INTEGER, allowNull: true, comment: 'prestador' },
      formas_atendimento: {
        type: DataTypes.ARRAY(DataTypes.STRING(20)),
        allowNull: false,
        defaultValue: [],
        comment: 'prestador',
      },
      entrega_observacao: { type: DataTypes.TEXT, allowNull: true, comment: 'loja' },
      formas_entrega: {
        type: DataTypes.ARRAY(DataTypes.STRING(20)),
        allowNull: false,
        defaultValue: [],
        comment: 'loja',
      },
      raio_entrega_km: { type: DataTypes.INTEGER, allowNull: true, comment: 'loja' },
      prazo_resposta_horas: { type: DataTypes.INTEGER, allowNull: true, comment: 'loja' },

      verificado_em: { type: DataTypes.DATE, allowNull: true },
      verificado_por: { type: DataTypes.UUID, allowNull: true },
      verificacao_observacao: { type: DataTypes.TEXT, allowNull: true },

      total_anuncios: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total_anuncios_ativos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total_visualizacoes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total_contatos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      membro_desde: { type: DataTypes.DATEONLY, allowNull: true },
      ultima_atividade_em: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'perfis',
      paranoid: true,
      indexes: [
        { unique: true, fields: ['slug'] },
        /* documento é único APENAS quando informado — índice parcial criado na
           migration (Sequelize não expressa `WHERE ... IS NOT NULL` aqui) */
        { fields: ['documento'] },
        { fields: ['tipo'] },
        { fields: ['municipio_id'] },
        { fields: ['uf'] },
      ],
    }
  );

  Perfil.associate = (models) => {
    Perfil.belongsTo(models.Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
    Perfil.belongsTo(models.Endereco, { foreignKey: 'endereco_id', as: 'endereco' });
    Perfil.belongsTo(models.Municipio, { foreignKey: 'municipio_id', as: 'municipio' });
    Perfil.hasMany(models.Anuncio, { foreignKey: 'perfil_id', as: 'anuncios' });
    Perfil.hasMany(models.PerfilHorario, { foreignKey: 'perfil_id', as: 'horarios' });
    Perfil.belongsToMany(models.Servico, {
      through: models.PerfilServico,
      foreignKey: 'perfil_id',
      otherKey: 'servico_id',
      as: 'servicos',
    });
    Perfil.belongsToMany(models.Marca, {
      through: models.PerfilMarca,
      foreignKey: 'perfil_id',
      otherKey: 'marca_id',
      as: 'marcas',
    });
    Perfil.belongsToMany(models.Municipio, {
      through: models.PerfilAreaAtendimento,
      foreignKey: 'perfil_id',
      otherKey: 'municipio_id',
      as: 'areaAtendimento',
    });
  };

  return Perfil;
};
