'use strict';

/**
 * Colunas que faltavam para "Atendimento" (loja) e "Meus serviços"
 * (prestador) terem o que já era mostrado na tela virarem dado real:
 *
 *  · `formas_entrega` (loja) — retirada/região/transportadora/propriedade.
 *  · `raio_entrega_km` (loja) — até onde a entrega na região alcança.
 *  · `prazo_resposta_horas` (loja) — compromisso de resposta, mostrado no
 *    perfil público como "responde em até Xh".
 *  · `formas_atendimento` (prestador) — campo/oficina/emergência. Existia só
 *    `atende_no_campo` (booleano), que não distinguia "só oficina" de
 *    "emergência fora do horário".
 *
 * Arrays de texto, não tabela nova: são vocabulários fechados e pequenos (no
 * máximo 4 opções), sem atributo próprio por item — a mesma razão por que
 * `notificacao.constants.js` trata canal como enum e não como tabela.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('perfis', 'formas_entrega', {
      type: Sequelize.ARRAY(Sequelize.STRING(20)),
      allowNull: false,
      defaultValue: [],
      comment: 'loja',
    });

    await queryInterface.addColumn('perfis', 'raio_entrega_km', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'loja',
    });

    await queryInterface.addColumn('perfis', 'prazo_resposta_horas', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'loja',
    });

    await queryInterface.addColumn('perfis', 'formas_atendimento', {
      type: Sequelize.ARRAY(Sequelize.STRING(20)),
      allowNull: false,
      defaultValue: [],
      comment: 'prestador',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('perfis', 'formas_entrega');
    await queryInterface.removeColumn('perfis', 'raio_entrega_km');
    await queryInterface.removeColumn('perfis', 'prazo_resposta_horas');
    await queryInterface.removeColumn('perfis', 'formas_atendimento');
  },
};
