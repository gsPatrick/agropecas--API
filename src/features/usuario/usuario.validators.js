'use strict';

const { campos, esquema } = require('../../validacao');
const { USUARIO_STATUS } = require('../../models/constantes');

/**
 * Esquemas de entrada da conta.
 *
 * Vocabulário de `src/validacao` — nenhuma biblioteca aparece aqui. Compilados
 * uma vez, no carregamento do módulo.
 *
 * Repare no que NÃO existe: nenhum esquema aceita `usuarioId`, `status` ou
 * `papeis` vindos do corpo. Quem decide de quem é o registro é o contexto
 * autenticado, e quem muda status é uma rota de moderação com permissão
 * própria — aceitar esses campos aqui seria oferecer escalada de privilégio
 * pelo formulário de perfil.
 */

const motivoObrigatorio = () =>
  campos
    .texto()
    .obrigatorio('Informe o motivo — ele fica registrado na auditoria.')
    .min(5, 'O motivo precisa explicar a decisão.')
    .max(500);

/** dados que o titular altera sozinho */
const atualizar = esquema({
  nome: campos.texto().min(2).max(160),
  telefone: campos.telefone().comoE164().permitindoNulo(),
  whatsapp: campos.telefone().comoE164().permitindoNulo(),
  idioma: campos.texto().min(2).max(10),
  fusoHorario: campos.texto().min(3).max(60),
});

/**
 * Troca de e-mail. Pede a senha atual porque e-mail é a chave de recuperação
 * da conta: quem sequestra uma sessão e troca o e-mail sem confirmar nada
 * fica dono da conta para sempre.
 */
const trocarEmail = esquema({
  email: campos.email().obrigatorio('Informe o novo e-mail.'),
  senhaAtual: campos.senha().obrigatorio('Confirme sua senha atual.'),
});

const confirmarEmail = esquema({
  codigo: campos.texto().obrigatorio('Informe o código.').min(4).max(10).somenteDigitos(),
});

const listagem = esquema({
  pagina: campos.inteiro().min(1),
  /* sem `max` aqui de propósito: quem pedir 5000 recebe a página no teto de
     `utils/paginacao` em vez de um 422. Recusar o pedido não protegeria mais
     o banco — o teto já protege — e quebraria front que manda o valor da
     preferência do usuário sem conhecer o limite */
  porPagina: campos.inteiro().min(1),
  busca: campos.texto().max(160),
  status: campos.umDe(USUARIO_STATUS),
  papel: campos.texto().max(40),
});

const suspender = esquema({
  motivo: motivoObrigatorio(),
  ate: campos.data().obrigatorio('Informe até quando a suspensão vale.'),
});

const banir = esquema({ motivo: motivoObrigatorio() });

const restaurar = esquema({ motivo: campos.texto().max(500) });

const atribuirPapel = esquema({
  papel: campos.texto().obrigatorio('Informe a chave do papel.').max(40),
  motivo: campos.texto().max(500),
  expiraEm: campos.data(),
});

/**
 * Exclusão de conta. Senha obrigatória pelo mesmo motivo da troca de e-mail —
 * e porque o efeito é irreversível para o titular: os dados pessoais são
 * substituídos na hora (ver `usuario.exclusao.service.js`).
 */
const excluirConta = esquema({
  senhaAtual: campos.senha().obrigatorio('Confirme sua senha para excluir a conta.'),
  motivo: campos.texto().max(500),
});

const identificador = esquema({ id: campos.uuid().obrigatorio('Identificador inválido.') });

const identificadorPapel = esquema({
  id: campos.uuid().obrigatorio('Identificador inválido.'),
  papel: campos.texto().obrigatorio('Informe a chave do papel.').max(40),
});

module.exports = {
  atualizar,
  trocarEmail,
  confirmarEmail,
  listagem,
  suspender,
  banir,
  restaurar,
  atribuirPapel,
  excluirConta,
  identificador,
  identificadorPapel,
};
