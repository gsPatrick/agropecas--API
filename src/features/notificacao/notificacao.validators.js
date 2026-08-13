'use strict';

const { campos, esquema } = require('../../validacao');
const { NOTIFICACAO_TIPO, NOTIFICACAO_CANAL, USUARIO_STATUS, PERFIL_TIPO } = require('../../models/constantes');
const { LISTA_MAXIMO, MARCAR_LOTE_MAXIMO } = require('./notificacao.constants');

/**
 * Esquemas de entrada. Compilados uma vez, no carregamento do módulo.
 *
 * Todos os vocabulários vêm dos enums dos models — repetir a lista de tipos
 * aqui faria a validação aceitar um valor que o banco recusa, e o erro
 * apareceria como 500 em vez de 422.
 */

const identificador = esquema({ id: campos.uuid().obrigatorio('Identificador inválido.') });

const listagem = esquema({
  pagina: campos.inteiro().min(1).padrao(1),
  porPagina: campos.inteiro().min(1).max(LISTA_MAXIMO).padrao(20),
  /* ausente = todas; o front do sininho manda `lida=false` */
  lida: campos.booleano(),
  tipo: campos.umDe(NOTIFICACAO_TIPO),
  canal: campos.umDe(NOTIFICACAO_CANAL),
});

const marcarVarias = esquema({
  ids: campos
    .lista(campos.uuid())
    .obrigatorio('Informe quais notificações marcar.')
    .min(1)
    .max(MARCAR_LOTE_MAXIMO, `Marque no máximo ${MARCAR_LOTE_MAXIMO} por vez.`),
});

const marcarTodas = esquema({ tipo: campos.umDe(NOTIFICACAO_TIPO) });

const preferencias = esquema({
  itens: campos
    .lista(
      campos.objeto({
        tipo: campos.umDe(NOTIFICACAO_TIPO).obrigatorio('Informe o tipo.'),
        canal: campos.umDe(NOTIFICACAO_CANAL).obrigatorio('Informe o canal.'),
        ativo: campos.booleano().obrigatorio('Informe se aceita ou não.'),
      })
    )
    .obrigatorio('Informe as preferências a salvar.')
    .min(1)
    /* teto no lote: a matriz completa tem 32 cruzamentos, e um corpo com mil
       itens só pode ser engano ou abuso */
    .max(100),
});

const criarTemplate = esquema({
  tipo: campos.umDe(NOTIFICACAO_TIPO).obrigatorio('Informe o tipo.'),
  canal: campos.umDe(NOTIFICACAO_CANAL).obrigatorio('Informe o canal.'),
  assunto: campos.texto().max(180),
  titulo: campos.texto().max(160),
  corpo: campos.textoLongo().obrigatorio('Escreva o corpo do aviso.').max(5000),
  corpoHtml: campos.textoLongo().max(20000),
  variaveis: campos.lista(campos.texto().max(40)),
  ativo: campos.booleano().padrao(true),
});

const atualizarTemplate = esquema({
  assunto: campos.texto().max(180),
  titulo: campos.texto().max(160),
  corpo: campos.textoLongo().max(5000),
  corpoHtml: campos.textoLongo().max(20000),
  variaveis: campos.lista(campos.texto().max(40)),
  ativo: campos.booleano(),
});

const enviarEmMassa = esquema({
  tipo: campos.umDe(NOTIFICACAO_TIPO).obrigatorio('Informe o tipo do aviso.'),
  titulo: campos.texto().obrigatorio('Escreva o título.').min(3).max(160),
  mensagem: campos.textoLongo().obrigatorio('Escreva a mensagem.').min(3).max(2000),
  /* payload livre para o front montar o link; é higienizado no service */
  dados: campos.objeto({ link: campos.texto().max(500) }),
  canais: campos.lista(campos.umDe(NOTIFICACAO_CANAL)),

  segmento: campos.objeto({
    status: campos.lista(campos.umDe(USUARIO_STATUS)),
    tipoPerfil: campos.umDe(PERFIL_TIPO),
    uf: campos.texto().min(2).max(2),
    usuarioIds: campos.lista(campos.uuid()),
  }),

  /* comunicado em massa é ação auditada: o motivo entra na trilha */
  motivo: campos.texto().max(300),
});

const listarEmMassa = esquema({
  pagina: campos.inteiro().min(1).padrao(1),
  porPagina: campos.inteiro().min(1).max(50).padrao(20),
});

module.exports = {
  identificador,
  listagem,
  marcarVarias,
  marcarTodas,
  preferencias,
  criarTemplate,
  atualizarTemplate,
  enviarEmMassa,
  listarEmMassa,
};
