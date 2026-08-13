'use strict';

const { USUARIO_STATUS } = require('./constantes');

/**
 * Usuario — a identidade. Só login, contato e estado da conta.
 * Dados de negócio (documento, razão social, bio) vivem em Perfil: um mesmo
 * usuário pode, no futuro, ter mais de um perfil sem duplicar credenciais.
 *
 * LGPD:
 *  · senha nunca em texto puro (senha_hash);
 *  · exclusão é anonimização (anonimizado_em) preservando integridade
 *    referencial de anúncios e conversas;
 *  · IPs de auditoria ficam em hash, não em claro.
 */
module.exports = (sequelize, DataTypes) => {
  const Usuario = sequelize.define(
    'Usuario',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

      nome: { type: DataTypes.STRING(160), allowNull: false },
      email: {
        type: DataTypes.STRING(180),
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      email_normalizado: {
        type: DataTypes.STRING(180),
        allowNull: false,
        comment: 'minúsculo e sem espaços — usado na busca e na unicidade real',
      },
      senha_hash: { type: DataTypes.STRING(255), allowNull: true },

      telefone: { type: DataTypes.STRING(20), allowNull: true, comment: 'E.164' },
      whatsapp: { type: DataTypes.STRING(20), allowNull: true, comment: 'E.164 — canal principal' },

      status: {
        type: DataTypes.ENUM(...USUARIO_STATUS),
        allowNull: false,
        defaultValue: 'ativo',
      },
      motivo_status: { type: DataTypes.TEXT, allowNull: true },
      suspenso_ate: { type: DataTypes.DATE, allowNull: true },

      email_verificado_em: { type: DataTypes.DATE, allowNull: true },
      telefone_verificado_em: { type: DataTypes.DATE, allowNull: true },

      ultimo_login_em: { type: DataTypes.DATE, allowNull: true },
      ultimo_login_ip_hash: { type: DataTypes.STRING(64), allowNull: true },
      total_logins: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      senha_alterada_em: { type: DataTypes.DATE, allowNull: true },
      tentativas_login: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      bloqueado_ate: { type: DataTypes.DATE, allowNull: true },

      idioma: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'pt-BR' },
      fuso_horario: { type: DataTypes.STRING(60), allowNull: false, defaultValue: 'America/Cuiaba' },

      anonimizado_em: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'LGPD: conta excluída pelo titular; dados pessoais substituídos',
      },
      excluir_definitivamente_em: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'fim do prazo de retenção legal — depois disso o registro pode ser descartado',
      },

      observacoes_internas: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'uso do Admin; nunca exposto ao titular na API pública',
      },
    },
    {
      tableName: 'usuarios',
      paranoid: true,
      indexes: [
        { unique: true, fields: ['email_normalizado'] },
        { fields: ['status'] },
        { fields: ['whatsapp'] },
        { fields: ['criado_em'] },
      ],
    }
  );

  Usuario.associate = (models) => {
    Usuario.hasOne(models.Perfil, { foreignKey: 'usuario_id', as: 'perfil' });
    Usuario.belongsToMany(models.Papel, {
      through: models.UsuarioPapel,
      foreignKey: 'usuario_id',
      otherKey: 'papel_id',
      as: 'papeis',
    });
    Usuario.hasMany(models.Anuncio, { foreignKey: 'usuario_id', as: 'anuncios' });
    Usuario.hasMany(models.Sessao, { foreignKey: 'usuario_id', as: 'sessoes' });
    Usuario.hasMany(models.TokenVerificacao, { foreignKey: 'usuario_id', as: 'tokens' });
    Usuario.hasMany(models.Consentimento, { foreignKey: 'usuario_id', as: 'consentimentos' });
    Usuario.hasMany(models.Notificacao, { foreignKey: 'usuario_id', as: 'notificacoes' });
    Usuario.hasMany(models.Favorito, { foreignKey: 'usuario_id', as: 'favoritos' });
    Usuario.hasMany(models.Assinatura, { foreignKey: 'usuario_id', as: 'assinaturas' });
    Usuario.hasMany(models.SolicitacaoTitular, { foreignKey: 'usuario_id', as: 'solicitacoesLgpd' });
  };

  return Usuario;
};
