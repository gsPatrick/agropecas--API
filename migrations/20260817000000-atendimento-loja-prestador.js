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
/**
 * Numa transação, e checando coluna a coluna antes de adicionar.
 *
 * O boot em produção roda `db:migrate` sozinho (Maturacao — deploy no
 * EasyPanel); se o processo cair no meio desta migração (container
 * reiniciado, deploy interrompido), as colunas já criadas ficavam prontas
 * mas `SequelizeMeta` nunca era gravada — o próximo boot tentava criar tudo
 * de novo e quebrava em "column already exists". A transação garante tudo
 * ou nada, e o `describeTable` cobre quem já ficou pela metade antes desta
 * correção existir.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const colunas = await queryInterface.describeTable('perfis');

      if (!colunas.formas_entrega) {
        await queryInterface.addColumn(
          'perfis',
          'formas_entrega',
          { type: Sequelize.ARRAY(Sequelize.STRING(20)), allowNull: false, defaultValue: [], comment: 'loja' },
          { transaction }
        );
      }

      if (!colunas.raio_entrega_km) {
        await queryInterface.addColumn(
          'perfis',
          'raio_entrega_km',
          { type: Sequelize.INTEGER, allowNull: true, comment: 'loja' },
          { transaction }
        );
      }

      if (!colunas.prazo_resposta_horas) {
        await queryInterface.addColumn(
          'perfis',
          'prazo_resposta_horas',
          { type: Sequelize.INTEGER, allowNull: true, comment: 'loja' },
          { transaction }
        );
      }

      if (!colunas.formas_atendimento) {
        await queryInterface.addColumn(
          'perfis',
          'formas_atendimento',
          { type: Sequelize.ARRAY(Sequelize.STRING(20)), allowNull: false, defaultValue: [], comment: 'prestador' },
          { transaction }
        );
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('perfis', 'formas_entrega', { transaction });
      await queryInterface.removeColumn('perfis', 'raio_entrega_km', { transaction });
      await queryInterface.removeColumn('perfis', 'prazo_resposta_horas', { transaction });
      await queryInterface.removeColumn('perfis', 'formas_atendimento', { transaction });
    });
  },
};
