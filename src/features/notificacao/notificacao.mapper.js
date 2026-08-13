'use strict';

/**
 * Model → JSON da API. Lista branca explícita.
 *
 * O que fica de fora e por quê:
 *
 * - `usuario_id` — a notificação só é entregue ao dono, então repetir o id
 *   dele em cada item é peso de rede sem informação. O Admin que lista com
 *   escopo `todas` recebe o campo pela variante `comDestinatario`.
 * - `falha_motivo`, `tentativas` — diagnóstico de entrega. Contar ao usuário
 *   que o provedor de e-mail recusou a mensagem não o ajuda e expõe
 *   infraestrutura.
 *
 * `dados` é payload livre montado por quem dispara a notificação. Ele é
 * higienizado na ESCRITA (ver `notificacao.criacao.service.js`), não aqui:
 * filtrar só na saída deixaria o dado sensível gravado no banco, que é
 * justamente o que a LGPD não perdoa.
 */

const notificacao = (registro) => {
  if (!registro) return null;

  return {
    id: registro.id,
    tipo: registro.tipo,
    canal: registro.canal,
    titulo: registro.titulo,
    mensagem: registro.corpo,
    link: registro.link,
    dados: registro.dados || {},
    entidade: registro.referencia_tipo,
    entidadeId: registro.referencia_id,
    lida: Boolean(registro.lida_em),
    lidaEm: registro.lida_em,
    criadoEm: registro.criado_em,
  };
};

/** variante do painel: quem tem `notificacao.ler.todas` precisa saber de quem é */
const comDestinatario = (registro) => ({
  ...notificacao(registro),
  usuarioId: registro.usuario_id,
});

const template = (registro) => ({
  id: registro.id,
  tipo: registro.tipo,
  canal: registro.canal,
  assunto: registro.assunto,
  titulo: registro.titulo,
  corpo: registro.corpo,
  corpoHtml: registro.corpo_html,
  variaveis: registro.variaveis || [],
  ativo: registro.ativo,
  atualizadoEm: registro.atualizado_em,
});

module.exports = { notificacao, comDestinatario, template };
