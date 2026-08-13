'use strict';

/**
 * Quarto tipo de perfil: `cliente`.
 *
 * Os três tipos do documento da cliente (produtor, loja, prestador) têm uma
 * coisa em comum que o cadastro sempre assumiu: todos publicam anúncio. Não
 * havia lugar para quem só quer comprar — procurar, favoritar, conversar — e
 * nunca vender nada. Essa pessoa era obrigada a se declarar "produtor" só
 * para ter conta, o que sujava a estatística de perfis e a deixava com um
 * painel cheio de botões de "Anunciar" que ela nunca usaria.
 *
 * `ALTER TYPE ... ADD VALUE` não roda dentro da mesma transação em que o
 * valor novo é usado — por isso este arquivo só acrescenta o valor ao enum, e
 * nada mais. Qualquer linha que precisar do tipo "cliente" entra em uma
 * migration ou seed POSTERIOR.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      "ALTER TYPE enum_perfis_tipo ADD VALUE IF NOT EXISTS 'cliente';"
    );
  },

  /**
   * Postgres não tem `DROP VALUE` para enum.
   *
   * Reverter de verdade exigiria recriar o tipo inteiro e todas as colunas que
   * o usam — uma migration destrutiva para desfazer uma migration aditiva.
   * Documentado como limitação conhecida, e não simulado com um `no-op`
   * silencioso: quem rodar `migrate:undo` nesta precisa saber que o valor
   * continua no banco.
   */
  async down() {
    throw new Error(
      'Não é possível remover um valor de enum no Postgres sem recriar o tipo. ' +
        'Reversão manual: garanta que nenhum perfil tenha tipo=cliente e recrie ' +
        'enum_perfis_tipo sem o valor, atualizando a coluna perfis.tipo.'
    );
  },
};
