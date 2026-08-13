'use strict';

const { campos, esquema } = require('../../validacao');
const {
  TIPOS_SOLICITACAO,
  STATUS_SOLICITACAO,
  TIPOS_DOCUMENTO,
  CONFIRMACAO_ANONIMIZACAO,
} = require('./lgpd.constants');

/**
 * Esquemas de entrada. Compilados uma vez, no carregamento do módulo.
 *
 * `usuarioId` aparece em dois esquemas e em nenhum dos dois ele é confiável —
 * quem decide sobre quem a ação incide é o RBAC no service. O campo existe
 * para que uma tentativa sobre dado de terceiro receba 403 explícito em vez de
 * ser silenciosamente redirecionada para a própria conta, o que esconderia a
 * tentativa de quem está lendo os logs.
 */

const identificador = esquema({ id: campos.uuid().obrigatorio() });

const abrirSolicitacao = esquema({
  tipo: campos.umDe(TIPOS_SOLICITACAO).obrigatorio('Informe o tipo de solicitação.'),
  descricao: campos.textoLongo().max(2000),
  usuarioId: campos.uuid(),
});

const listarMinhas = esquema({
  status: campos.umDe(STATUS_SOLICITACAO),
  tipo: campos.umDe(TIPOS_SOLICITACAO),
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(50),
});

const listarSolicitacoes = esquema({
  status: campos.umDe(STATUS_SOLICITACAO),
  tipo: campos.umDe(TIPOS_SOLICITACAO),
  vencendo: campos.booleano(),
  de: campos.data(),
  ate: campos.data(),
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
});

const responder = esquema({
  status: campos
    .umDe(['em_atendimento', 'concluida', 'recusada'])
    .obrigatorio('Informe a situação da solicitação.'),
  /* resposta obrigatória mesmo na recusa: o art. 18 §4º exige justificativa
     quando o pedido não é atendido, e um campo opcional acaba vazio */
  resposta: campos
    .textoLongo()
    .obrigatorio('Descreva a resposta ao titular.')
    .min(10, 'A resposta precisa explicar o que foi feito.')
    .max(5000),
});

const reautenticar = esquema({
  senha: campos.senha().obrigatorio('Confirme sua senha para continuar.'),
});

const confirmarCodigo = esquema({
  codigo: campos.texto().obrigatorio('Informe o código enviado ao seu e-mail.').min(4).max(10),
});

const anonimizar = esquema({
  usuarioId: campos.uuid(),
  confirmacao: campos
    .texto()
    .obrigatorio(`Digite "${CONFIRMACAO_ANONIMIZACAO}" para confirmar.`)
    .regraPersonalizada(
      (valor) =>
        valor === CONFIRMACAO_ANONIMIZACAO
          ? null
          : `Digite exatamente: "${CONFIRMACAO_ANONIMIZACAO}".`
    ),
  /* obrigatória só quando é a própria conta; o service resolve, porque só ele
     sabe de quem é a conta alvo */
  senha: campos.senha(),
  motivo: campos.texto().max(255),
});

const exportarParaTitular = esquema({
  usuarioId: campos.uuid().obrigatorio(),
  motivo: campos.texto().obrigatorio('Registre o motivo — é o que sustenta o acesso.').min(5).max(255),
});

const publicarDocumento = esquema({
  tipo: campos.umDe(TIPOS_DOCUMENTO).obrigatorio(),
  versao: campos
    .texto()
    .obrigatorio('Informe a versão.')
    .max(20)
    .padraoTexto(/^\d+(\.\d+){0,2}$/, 'Use o formato 1.0 ou 1.0.2.'),
  titulo: campos.texto().obrigatorio().min(5).max(180),
  conteudo: campos.textoLongo().obrigatorio('O texto do documento não pode ficar vazio.').min(50),
  resumoMudancas: campos.textoLongo().max(2000),
  vigenteDe: campos.data(),
  exigeNovoAceite: campos.booleano().padrao(true),
});

const tipoDocumento = esquema({ tipo: campos.umDe(TIPOS_DOCUMENTO).obrigatorio() });

const filtroDocumento = esquema({ tipo: campos.umDe(TIPOS_DOCUMENTO) });

const tokenDownload = esquema({
  token: campos.texto().obrigatorio().min(20).max(120),
});

module.exports = {
  identificador,
  abrirSolicitacao,
  listarMinhas,
  listarSolicitacoes,
  responder,
  reautenticar,
  confirmarCodigo,
  anonimizar,
  exportarParaTitular,
  publicarDocumento,
  tipoDocumento,
  filtroDocumento,
  tokenDownload,
};
