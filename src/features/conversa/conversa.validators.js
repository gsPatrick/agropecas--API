'use strict';

const { campos, esquema } = require('../../validacao');
const { CONTEUDO_MAXIMO, MENSAGENS_POR_PAGINA_MAXIMO } = require('./conversa.constants');

/**
 * Esquemas de entrada da feature.
 *
 * Nenhum id de usuário entra por aqui a não ser o do ALVO de um bloqueio: quem
 * envia e quem lê saem sempre de `contexto.usuarioId`. Aceitar `remetenteId`
 * no corpo seria dar ao cliente a chave de falar em nome de outro.
 */

const conteudo = () =>
  campos
    .texto()
    .min(1, 'Escreva alguma coisa.')
    .max(CONTEUDO_MAXIMO, `A mensagem passa de ${CONTEUDO_MAXIMO} caracteres.`);

const iniciar = esquema({
  anuncioId: campos.uuid().obrigatorio('Informe o anúncio.'),
  /* a primeira mensagem é opcional: a tela do anúncio pode abrir a conversa
     vazia e deixar a pessoa escrever depois */
  mensagem: conteudo(),
});

const enviar = esquema({
  conteudo: conteudo().obrigatorio('Escreva alguma coisa.'),
});

const listar = esquema({
  pagina: campos.inteiro().min(1).padrao(1),
  porPagina: campos.inteiro().min(1).max(100).padrao(20),
  /* por padrão a caixa de entrada esconde o que foi arquivado */
  arquivadas: campos.booleano().padrao(false),
});

const mensagens = esquema({
  /* cursor opaco (base64 de `criado_em|id`). Offset em chat pula mensagem
     quando chega uma nova durante a rolagem — ver Conversa.md §4 */
  antesDe: campos.texto().max(120),
  limite: campos.inteiro().min(1).max(MENSAGENS_POR_PAGINA_MAXIMO),
});

const bloquear = esquema({
  usuarioId: campos.uuid().obrigatorio('Informe quem será bloqueado.'),
  motivo: campos.texto().max(255),
});

const remover = esquema({
  motivo: campos.texto().max(255),
});

const encerrar = esquema({
  motivo: campos.texto().max(255),
});

const identificador = esquema({ id: campos.uuid().obrigatorio('Identificador inválido.') });

const identificadorUsuario = esquema({
  usuarioId: campos.uuid().obrigatorio('Identificador inválido.'),
});

module.exports = {
  iniciar,
  enviar,
  listar,
  mensagens,
  bloquear,
  remover,
  encerrar,
  identificador,
  identificadorUsuario,
};
