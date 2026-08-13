'use strict';

/**
 * Cultura — vocabulário do que se produz na propriedade (soja, milho, algodão,
 * gado de corte…).
 *
 * POR QUE TABELA DE VOCABULÁRIO E NÃO UM ARRAY DE TEXTO EM `perfis`:
 *
 * A pergunta que este dado precisa responder é "quem planta soja em Sorriso?"
 * — para a loja mandar oferta de peça de plantadeira e para o prestador saber
 * onde está a demanda de regulagem. Com array de texto livre, "Soja", "soja",
 * "SOJA" e "soja transgênica" viram quatro respostas diferentes para a mesma
 * pergunta, e nenhuma delas encontra as outras. O produtor some da busca
 * achando que está cadastrado — o mesmo motivo pelo qual `servicos` já é
 * catálogo e não campo livre.
 *
 * Um array de UUIDs resolveria a grafia mas não o resto: não há FK (cultura
 * removida deixa id órfão), não há como contar produtores por cultura sem
 * varrer a tabela inteira, e o GIN de array não serve o join que a listagem
 * pública de perfis já faz com `perfil_servicos`/`perfil_marcas`.
 *
 * Portanto: vocabulário + pivô, exatamente no padrão de `servicos`. O custo é
 * uma tabela a mais; o ganho é a busca funcionar e o Admin conseguir renomear
 * "Milho safrinha" sem um UPDATE em texto espalhado por N perfis.
 */
module.exports = (sequelize, DataTypes) => {
  const Cultura = sequelize.define(
    'Cultura',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

      nome: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      nome_normalizado: { type: DataTypes.STRING(120), allowNull: false },
      slug: { type: DataTypes.STRING(140), allowNull: false, unique: true },
      icone: { type: DataTypes.STRING(40), allowNull: true },

      /* lavoura e pecuária dividem a mesma lista na tela do produtor ("o que
         você produz"), mas quem vende peça de plantadeira não quer falar com
         quem só tem gado — o grupo é o que permite separar depois */
      grupo: {
        type: DataTypes.ENUM('lavoura', 'pecuaria', 'outro'),
        allowNull: false,
        defaultValue: 'lavoura',
      },

      ordem: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      /* contador é coluna, não COUNT(*) por requisição (PADRAO_MODULO §10.4) */
      total_produtores: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'culturas',
      paranoid: true,
      indexes: [{ unique: true, fields: ['slug'] }, { fields: ['ativo', 'ordem'] }],
    }
  );

  /* as associações do lado do Perfil são declaradas AQUI e não em `perfil.js`:
     o model do perfil é compartilhado por vários módulos em escrita paralela, e
     Sequelize aceita registrar a associação a partir de qualquer um dos lados */
  Cultura.associate = (models) => {
    Cultura.belongsToMany(models.Perfil, {
      through: models.PerfilCultura,
      foreignKey: 'cultura_id',
      otherKey: 'perfil_id',
      as: 'perfis',
    });

    models.Perfil.belongsToMany(Cultura, {
      through: models.PerfilCultura,
      foreignKey: 'perfil_id',
      otherKey: 'cultura_id',
      as: 'culturas',
    });
  };

  return Cultura;
};
