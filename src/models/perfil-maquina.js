'use strict';

/**
 * PerfilMaquina — o maquinário da propriedade do produtor.
 *
 * NÃO é pivô para `maquinas` (o catálogo de modelos). É registro próprio, e a
 * decisão vem de uma regra de produto explícita: quem tem implemento de
 * fabricante pequeno — plataforma de uma metalúrgica da região, carreta de
 * fabricante local — precisa conseguir cadastrar. Amarrar em FK obrigatória
 * contra `maquinas` faria a tela recusar exatamente o equipamento que ninguém
 * mais cataloga, e o produtor desistiria do cadastro.
 *
 * O meio-termo é `marca_id` OPCIONAL contra `marcas` mais `marca_nome` sempre
 * preenchido:
 *
 *  · quando a marca está no catálogo, `marca_id` aponta para ela e a busca
 *    "quem tem John Deere" é um join com FK, não um LIKE em texto;
 *  · quando não está, `marca_id` fica nulo e só o texto sobrevive — o cadastro
 *    passa, e o Admin consegue depois listar os textos livres mais repetidos
 *    para promovê-los a marca do catálogo.
 *
 * `marca_nome` é gravado nos DOIS casos (cópia do catálogo quando resolvido):
 * a lista da tela mostra "John Deere 6110J" sem join, e o texto continua certo
 * se a marca for renomeada ou removida do catálogo.
 */
module.exports = (sequelize, DataTypes) => {
  const PerfilMaquina = sequelize.define(
    'PerfilMaquina',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      perfil_id: { type: DataTypes.UUID, allowNull: false },

      marca_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'nulo quando a marca não está no catálogo — ver marca_nome',
      },
      marca_nome: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: 'sempre preenchido; cópia do catálogo quando marca_id resolve',
      },

      modelo: { type: DataTypes.STRING(120), allowNull: false },
      modelo_normalizado: {
        type: DataTypes.STRING(120),
        allowNull: false,
        comment: 'sem acento e minúsculo: "6110j" precisa achar "6110J"',
      },

      /* mesmo vocabulário de `maquinas.categoria_maquina`: os dois descrevem a
         mesma coisa, e divergir faria o filtro do catálogo não bater com o
         filtro da frota */
      tipo: {
        type: DataTypes.ENUM(
          'trator',
          'colheitadeira',
          'pulverizador',
          'plantadeira',
          'implemento',
          'caminhao',
          'motor',
          'outro'
        ),
        allowNull: false,
        defaultValue: 'trator',
      },

      ano: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'ano do equipamento; a faixa válida é constraint na migration',
      },
      identificacao: {
        type: DataTypes.STRING(60),
        allowNull: true,
        comment: 'apelido ou número de frota interno do produtor',
      },
      observacao: { type: DataTypes.STRING(255), allowNull: true },

      /* o catálogo de modelos, quando o produtor escolher da lista em vez de
         digitar. Opcional pelo mesmo motivo de `marca_id` */
      maquina_id: { type: DataTypes.UUID, allowNull: true },
    },
    {
      tableName: 'perfil_maquinas',
      paranoid: false,
      indexes: [
        { fields: ['perfil_id'] },
        { fields: ['marca_id'] },
        { fields: ['modelo_normalizado'] },
      ],
    }
  );

  /* declaradas aqui, e não em `perfil.js`, para não disputar um arquivo
     compartilhado com os outros módulos em escrita paralela */
  PerfilMaquina.associate = (models) => {
    PerfilMaquina.belongsTo(models.Perfil, { foreignKey: 'perfil_id', as: 'perfil' });
    PerfilMaquina.belongsTo(models.Marca, { foreignKey: 'marca_id', as: 'marca' });
    PerfilMaquina.belongsTo(models.Maquina, { foreignKey: 'maquina_id', as: 'maquina' });

    models.Perfil.hasMany(PerfilMaquina, { foreignKey: 'perfil_id', as: 'maquinas' });
  };

  return PerfilMaquina;
};
