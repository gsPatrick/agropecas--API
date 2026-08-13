'use strict';

const { situacaoDoPrazo } = require('./lgpd.solicitacao.service');

/**
 * Model → JSON. Lista branca explícita: `ip_hash` e `email_solicitante` estão
 * na tabela e NÃO saem daqui para a lista do encarregado — o primeiro é
 * pseudônimo que não ajuda ninguém na tela, o segundo é dado de contato que
 * aparece só no detalhe, para quem está de fato atendendo aquele protocolo.
 */

const solicitacao = (registro, { detalhe = false } = {}) => {
  if (!registro) return null;
  const prazo = situacaoDoPrazo(registro);

  return {
    id: registro.id,
    tipo: registro.tipo,
    status: registro.status,
    descricao: registro.descricao,
    identidadeVerificada: Boolean(registro.identidade_verificada_em),
    prazoEm: registro.prazo_em,
    /* o front não precisa recalcular o prazo legal — e se recalculasse, um dia
       calcularia diferente do servidor */
    diasRestantes: prazo.diasRestantes,
    vencendo: prazo.vencendo,
    atrasada: prazo.atrasada,
    respondidaEm: registro.respondida_em,
    resposta: registro.resposta,
    arquivoUrl: registro.arquivo_url,
    criadoEm: registro.criado_em,
    ...(detalhe
      ? {
          emailSolicitante: registro.email_solicitante,
          usuarioId: registro.usuario_id,
          respondidaPor: registro.respondida_por,
        }
      : {}),
    titular: registro.usuario ? { id: registro.usuario.id, nome: registro.usuario.nome } : undefined,
  };
};

/** metadados do documento; `conteudo` só sai no endpoint que mostra o texto */
const documento = (registro) => {
  if (!registro) return null;
  return {
    id: registro.id,
    tipo: registro.tipo,
    versao: registro.versao,
    titulo: registro.titulo,
    resumoMudancas: registro.resumo_mudancas,
    /* o hash é publicado de propósito: é o que permite ao titular conferir que
       o texto que ele aceitou é o mesmo que está no ar */
    hashConteudo: registro.hash_conteudo,
    vigenteDe: registro.vigente_de,
    vigenteAte: registro.vigente_ate,
    exigeNovoAceite: Boolean(registro.exige_novo_aceite),
    vigente: !registro.vigente_ate || new Date(registro.vigente_ate) > new Date(),
  };
};

const documentoCompleto = (registro) => ({ ...documento(registro), conteudo: registro.conteudo });

const consentimento = (registro) => ({
  id: registro.id,
  tipo: registro.tipo,
  aceito: registro.aceito,
  versaoDocumento: registro.versao_documento,
  baseLegal: registro.base_legal,
  finalidade: registro.finalidade,
  origem: registro.origem,
  revogadoEm: registro.revogado_em,
  criadoEm: registro.criado_em,
});

const consentimentoAtual = ({ registro, desatualizado }) => ({
  ...consentimento(registro),
  desatualizado,
});

module.exports = { solicitacao, documento, documentoCompleto, consentimento, consentimentoAtual };
