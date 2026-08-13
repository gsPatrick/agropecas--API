'use strict';

const { CONTEUDO_REMOVIDO } = require('./conversa.constants');

/**
 * Model → JSON da API.
 *
 * Este é o mapper mais sensível do sistema: a conversa junta, num mesmo
 * payload, dado pessoal de DUAS pessoas. Lista branca aqui não é formalidade —
 * um `...registro.dataValues` esquecido publicaria telefone, documento e
 * endereço da outra parte para quem só queria ler mensagem.
 *
 * Regra de contato (LGPD): o WhatsApp da outra parte só sai quando o perfil
 * dela tem `exibir_whatsapp = true`. É consentimento, não preferência de UI —
 * e vale igual dentro do chat, onde a tentação de "já que estão conversando"
 * é maior.
 */

/** a outra ponta da conversa, do jeito que a lista precisa mostrar */
const parte = (usuario) => {
  if (!usuario) return null;

  const perfil = usuario.perfil || null;

  return {
    id: usuario.id,
    nome: perfil?.nome_exibicao || usuario.nome,
    slug: perfil?.slug || null,
    tipo: perfil?.tipo || null,
    fotoUrl: perfil?.foto_url || null,
    verificado: Boolean(perfil?.verificado_em),
    /* consentimento espelhado do perfil — ver cabeçalho */
    whatsapp: perfil?.exibir_whatsapp ? perfil.whatsapp : null,
    aceitaChat: perfil ? perfil.aceita_chat : null,
  };
};

/** o anúncio é o contexto obrigatório da conversa (Maturacao/05, §8.2.1) */
const anuncio = (registro) => {
  if (!registro) return null;
  return {
    id: registro.id,
    codigo: registro.codigo,
    titulo: registro.titulo,
    slug: registro.slug,
    status: registro.status,
    precoCentavos: registro.preco_centavos ?? null,
  };
};

const mensagem = (registro, { usuarioId } = {}) => {
  if (!registro) return null;

  const removida = Boolean(registro.removida_em);

  return {
    id: registro.id,
    conversaId: registro.conversa_id,
    remetenteId: registro.remetente_id,
    /* o front alinha o balão por isto e não comparando ids soltos */
    minha: Boolean(usuarioId) && String(registro.remetente_id) === String(usuarioId),
    tipo: registro.tipo,
    /* mensagem removida some da tela mas não do banco: o registro segue lá
       para a moderação apurar denúncia */
    conteudo: removida ? CONTEUDO_REMOVIDO : registro.conteudo,
    removida,
    removidaEm: registro.removida_em,
    anexoUrl: removida ? null : registro.anexo_url,
    anexoMime: removida ? null : registro.anexo_mime,
    editadaEm: registro.editada_em,
    lidaEm: registro.lida_em,
    criadoEm: registro.criado_em,
  };
};

/**
 * Item da caixa de entrada.
 *
 * Recebe o PARTICIPANTE (estado por pessoa: não lidas, arquivamento) com a
 * conversa incluída. Prévia e horário vêm desnormalizados da própria conversa —
 * é o que permite montar a tela inteira sem tocar em `mensagens`.
 */
const item = (participante, { usuarioId } = {}) => {
  const conversa = participante.conversa || participante.Conversa;
  if (!conversa) return null;

  const souAnunciante = participante.papel === 'anunciante';
  const outra = souAnunciante ? conversa.interessado : conversa.anunciante;

  return {
    id: conversa.id,
    status: conversa.status,
    papel: participante.papel,
    anuncio: anuncio(conversa.anuncio),
    outraParte: parte(outra),

    naoLidas: participante.nao_lidas,
    arquivada: Boolean(participante.arquivada_em),
    silenciada: Boolean(participante.silenciada_em),
    fixada: participante.fixada,
    ultimaLeituraEm: participante.ultima_leitura_em,

    ultimaMensagem: conversa.ultima_mensagem_em
      ? {
          previa: conversa.ultima_mensagem_previa,
          em: conversa.ultima_mensagem_em,
          /* quem mandou a última decide se a tela mostra "você:" */
          minha: String(conversa.ultima_mensagem_de) === String(usuarioId),
        }
      : null,

    totalMensagens: conversa.total_mensagens,
    encerradaEm: conversa.encerrada_em,
    criadoEm: conversa.criado_em,
  };
};

/** cabeçalho da tela da conversa — o mesmo item, sem o que só a lista usa */
const detalhe = (participante, opcoes) => {
  const base = item(participante, opcoes);
  if (!base) return null;
  return { ...base, podeEnviar: base.status === 'aberta' };
};

const bloqueio = (registro) => ({
  id: registro.id,
  usuarioId: registro.bloqueado_id,
  nome: registro.bloqueado?.nome || null,
  motivo: registro.motivo,
  criadoEm: registro.criado_em,
});

module.exports = { parte, anuncio, mensagem, item, detalhe, bloqueio };
