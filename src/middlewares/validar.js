'use strict';

const { validar: rodar } = require('../validacao');

/**
 * Aplica um esquema ao corpo, query ou params.
 *
 *   router.post('/entrar', validar(esquemas.login), ctrl.entrar);
 *   router.get('/', validar.query(esquemas.listagem), ctrl.listar);
 *
 * **Substitui a fonte pelo dado validado.** A partir daqui, `req.body` tem
 * número onde é número, telefone em E.164 e nenhum campo desconhecido — o
 * controller não precisa desconfiar da entrada, e `papeis: ['admin']` enviado
 * por um curioso simplesmente não existe mais.
 *
 * A validação sai do controller de propósito: controller que valida vira
 * controller gordo, e a mesma regra acaba reescrita em cada rota.
 */
const criar = (fonte) => (esquema) => (req, res, next) => {
  try {
    const limpo = rodar(req[fonte], esquema);

    /* `req.query` é getter em Express 5; atribuir direto quebraria. Definir a
       propriedade funciona nas duas versões */
    Object.defineProperty(req, fonte, { value: limpo, writable: true, configurable: true });
    next();
  } catch (erro) {
    next(erro);
  }
};

const validar = criar('body');
validar.body = criar('body');
validar.query = criar('query');
validar.params = criar('params');

module.exports = validar;
module.exports.validar = validar;
