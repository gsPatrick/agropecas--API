'use strict';

/**
 * AnuncioAtributo — ficha técnica em chave/valor.
 *
 * Peça agrícola tem atributo demais e imprevisível (diâmetro, passo, número de
 * dentes, aplicação). Coluna fixa para cada um significaria migration a cada
 * categoria nova; aqui o Admin cria a chave e o anunciante preenche.
 */
module.exports = (sequelize, DataTypes) => {
  const AnuncioAtributo = sequelize.define(
    'AnuncioAtributo',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      anuncio_id: { type: DataTypes.UUID, allowNull: false },

      chave: { type: DataTypes.STRING(60), allowNull: false },
      rotulo: { type: DataTypes.STRING(80), allowNull: false },
      valor: { type: DataTypes.STRING(255), allowNull: false },
      valor_numerico: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: true,
        comment: 'preenchido quando o atributo é numérico — permite filtro por faixa',
      },
      unidade: { type: DataTypes.STRING(20), allowNull: true },
      ordem: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      filtravel: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'anuncio_atributos',
      paranoid: false,
      indexes: [
        { fields: ['anuncio_id'] },
        { fields: ['chave', 'valor'] },
      ],
    }
  );

  AnuncioAtributo.associate = (models) => {
    AnuncioAtributo.belongsTo(models.Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });
  };

  return AnuncioAtributo;
};
