'use strict';

/**
 * Model → JSON da API.
 *
 * Lista branca, e neste módulo ela é a última barreira antes de um dado
 * pessoal virar resposta HTTP. Três campos existem na tabela e **nunca** saem
 * daqui:
 *
 *   `ip_hash`     — pseudonimizado, mas ainda é rastro; serve à apuração
 *                   interna de abuso, não ao anunciante;
 *   `user_agent`  — idem, e ajuda a impressão digital do navegador;
 *   `sessao_hash` — correlaciona visitas do mesmo dispositivo.
 *
 * Se um dia alguém precisar deles numa tela de moderação, o caminho é um
 * mapper próprio para o Admin — não afrouxar este.
 */

/** o interessado, do ponto de vista do anunciante: nome e mais nada */
const interessado = (registro) => {
  if (!registro) return null;
  return { id: registro.id, nome: registro.nome };
};

const contato = (registro) => ({
  id: registro.id,
  anuncioId: registro.anuncio_id,
  canal: registro.canal,
  origem: registro.origem,
  conversaId: registro.conversa_id,
  criadoEm: registro.criado_em,
  /* nulo quando o clique foi de visitante: informação real, não falha */
  interessado: interessado(registro.interessado),
  anonimo: !registro.interessado_id,
  anuncio: registro.anuncio
    ? {
        id: registro.anuncio.id,
        titulo: registro.anuncio.titulo,
        slug: registro.anuncio.slug,
        codigo: registro.anuncio.codigo,
      }
    : undefined,
});

const lista = (registros = []) => registros.map(contato);

/**
 * Resposta do registro de intenção.
 *
 * Devolve `registrado: false` sem erro quando a janela já contou este
 * interessado. O front não precisa tratar isso: ele já abriu o WhatsApp.
 */
const registro = ({ registrado, motivo, contato: criado }) => ({
  registrado,
  motivo,
  contatoId: criado ? criado.id : null,
});

/**
 * Revelação de contato.
 *
 * `whatsapp` vem NULO quando o anunciante não consentiu — e `exibirWhatsapp`
 * diz por quê, para o front oferecer o chat em vez de mostrar campo vazio.
 */
const revelacao = (dados) => ({
  anuncioId: dados.anuncioId,
  anunciante: dados.anunciante,
  whatsapp: dados.whatsapp,
  exibirWhatsapp: dados.exibirWhatsapp,
  aceitaChat: dados.aceitaChat,
  revelacoesRestantes: dados.revelacoesRestantes,
});

module.exports = { contato, lista, registro, revelacao, interessado };
