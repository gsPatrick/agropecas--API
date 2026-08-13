'use strict';

/**
 * Vocabulário e limites da feature.
 *
 * Os números daqui são política de segurança e de produto, não detalhe de
 * implementação — por isso ficam num arquivo que alguém consegue abrir e
 * discutir sem ler service nenhum.
 */

/** canais previstos em `anuncio_contatos.canal` (ENUM do banco) */
const CANAL = {
  WHATSAPP: 'whatsapp',
  CHAT: 'chat',
  TELEFONE: 'telefone',
  EMAIL: 'email',
};

const CANAIS = Object.values(CANAL);

/** de onde partiu o clique — alimenta o relatório de conversão por tela */
const ORIGENS = ['detalhe', 'listagem', 'busca', 'perfil', 'compartilhamento', 'favoritos'];

/**
 * Janela anti-refresh do contador, em segundos.
 *
 * O mesmo interessado abrindo o anúncio três vezes na mesma tarde é **um**
 * interessado. Sem janela, o número que a cliente usa para provar valor
 * ("quantas pessoas me chamaram") vira contagem de F5, e uma métrica que
 * qualquer um infla sem querer não sustenta decisão nenhuma.
 *
 * Seis horas é o compromisso: cobre a sessão de pesquisa inteira de um
 * comprador, e ainda conta separado quem voltou no dia seguinte para negociar
 * de novo — que é contato real.
 */
const JANELA_CONTATO_SEGUNDOS = 6 * 60 * 60;

/**
 * Limite de revelações de contato por pessoa.
 *
 * É a defesa contra raspagem: sem ela, um script autenticado percorre a
 * listagem e sai com a agenda telefônica de todos os anunciantes de MT em
 * poucos minutos — que é exatamente a base que a plataforma existe para
 * intermediar.
 *
 * O limite é por PESSOA e por JANELA, **não por anúncio**: limitar por anúncio
 * não atrapalha em nada quem quer os números de mil anúncios diferentes, que é
 * o ataque que importa.
 *
 * 30 por hora é folgado para uso humano (quem compara peça olha uma dezena de
 * anúncios) e inviável para coleta em escala.
 */
const REVELACAO = {
  MAXIMO: 30,
  JANELA_SEGUNDOS: 60 * 60,
};

/** motivo gravado em `logs_acesso_dado` — vocabulário fechado */
const MOTIVO_ACESSO = 'contato_anunciante_revelado';

/** recurso registrado no log de acesso a dado pessoal */
const RECURSO_ACESSO = 'telefone';

/** tipo da notificação enviada ao anunciante (ver `models/constantes.js`) */
const NOTIFICACAO_TIPO = 'sistema';

module.exports = {
  CANAL,
  CANAIS,
  ORIGENS,
  JANELA_CONTATO_SEGUNDOS,
  REVELACAO,
  MOTIVO_ACESSO,
  RECURSO_ACESSO,
  NOTIFICACAO_TIPO,
};
