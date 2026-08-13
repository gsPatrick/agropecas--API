'use strict';

const db = require('../../models');
const filas = require('../../filas');
const tempoReal = require('../../tempo-real');
const { erros } = require('../../utils/erros');
const preferenciaService = require('./notificacao.preferencia.service');
const templateService = require('./notificacao.template.service');
const contadorService = require('./notificacao.contador.service');
const mapper = require('./notificacao.mapper');
const { CANAIS_ENTREGUES, TIPOS } = require('./notificacao.constants');

/**
 * Criação de notificação — a porta de entrada de TODO o sistema de avisos.
 *
 * Os outros módulos (conversa, anúncio, moderação, denúncia) chegam aqui de
 * dois jeitos, com a mesma assinatura:
 *
 * ```js
 * await filas.enfileirar('notificacao.criar', { usuarioId, tipo, titulo,
 *   mensagem, dados, entidade, entidadeId, canais: ['sistema'] });
 *
 * await notificacaoService.criar({ ...mesma coisa });
 * ```
 *
 * A fila é o caminho normal: notificar não pode entrar no tempo de resposta de
 * quem mandou a mensagem. A chamada direta existe para quando o disparo já
 * está dentro de um job, ou quando quem chama precisa do registro criado de
 * volta na mesma transação lógica.
 *
 * **Uma linha por canal.** O model foi desenhado assim de propósito: é o que
 * permite saber que o aviso apareceu no sininho mas o e-mail falhou. O
 * contador de não lidas só olha o canal `sistema` — a linha de e-mail não é
 * algo que se "lê" dentro da plataforma.
 */

/**
 * Chaves que NUNCA entram no payload de uma notificação.
 *
 * O `dados` é livre para o front montar o link, e é exatamente por ser livre
 * que precisa de rede de proteção: "fulano te mandou uma mensagem" com o
 * telefone do fulano dentro é vazamento de dado pessoal de terceiro, gravado
 * no banco e entregue por WebSocket. O contato só sai pelo perfil, onde
 * `exibir_whatsapp` decide (consentimento LGPD, não preferência de UI).
 *
 * Filtrar na escrita e não na leitura é deliberado: o que não foi gravado não
 * vaza por uma rota nova que alguém escreva com pressa amanhã.
 */
const CHAVES_PROIBIDAS = [
  'telefone',
  'whatsapp',
  'celular',
  'email',
  'e_mail',
  'documento',
  'cpf',
  'cnpj',
  'senha',
  'token',
  'ip',
  'ip_hash',
  'endereco',
];

function limparDados(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return {};

  const limpo = {};
  Object.entries(dados).forEach(([chave, valor]) => {
    const normalizada = chave
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase();

    if (CHAVES_PROIBIDAS.some((proibida) => normalizada.includes(proibida))) return;
    /* só valor escalar: objeto aninhado esconderia um telefone um nível abaixo
       do filtro, e nenhum link precisa de estrutura profunda */
    if (valor !== null && typeof valor === 'object') return;

    limpo[chave] = valor;
  });

  return limpo;
}

/** destinatário precisa existir e estar em condição de receber */
async function destinatario(usuarioId) {
  const usuario = await db.Usuario.findByPk(usuarioId, {
    attributes: ['id', 'nome', 'email', 'status'],
    raw: true,
  });

  if (!usuario) return null;
  /* conta removida (anonimizada pela LGPD) não recebe: escrever para ela seria
     recriar dado de quem pediu para ser esquecido */
  if (['removido', 'banido'].includes(usuario.status)) return null;

  return usuario;
}

/**
 * Cria a notificação, respeita as preferências e entrega em tempo real.
 *
 * Nunca lança por destinatário inexistente ou preferência desligada: isso não
 * é erro, é o resultado normal. Lançar faria a fila retentar cinco vezes um
 * aviso que ninguém quer receber.
 *
 * @returns {{ criadas: object[], ignorados: string[] }}
 */
async function criar({
  usuarioId,
  tipo,
  titulo,
  mensagem,
  dados = {},
  entidade,
  entidadeId,
  canais = ['sistema'],
} = {}) {
  if (!usuarioId) throw erros.invalido('Notificação sem destinatário.');
  if (!TIPOS.includes(tipo)) {
    throw erros.invalido(`Tipo de notificação desconhecido: ${tipo}`, { tipo });
  }

  const usuario = await destinatario(usuarioId);
  if (!usuario) return { criadas: [], ignorados: ['destinatario_indisponivel'] };

  const payload = limparDados(dados);
  const preferencias = await preferenciaService.mapa(usuarioId);
  const ignorados = [];

  const pedidos = [...new Set(canais)].filter((canal) => {
    if (!CANAIS_ENTREGUES.includes(canal)) {
      ignorados.push(`${canal}:sem_provider`);
      return false;
    }
    if (!preferenciaService.permiteNoMapa(preferencias, tipo, canal)) {
      ignorados.push(`${canal}:preferencia_desligada`);
      return false;
    }
    return true;
  });

  if (!pedidos.length) return { criadas: [], ignorados };

  /* o texto é montado por canal: o título do sininho e o assunto do e-mail
     saem de templates diferentes, e é o Admin quem edita cada um */
  const textos = {};
  await Promise.all(
    pedidos.map(async (canal) => {
      textos[canal] = await templateService.montar({
        tipo,
        canal,
        titulo,
        mensagem,
        dados: { ...payload, nome: usuario.nome },
      });
    })
  );

  const agora = new Date();
  const linhas = pedidos.map((canal) => ({
    usuario_id: usuarioId,
    tipo,
    canal,
    titulo: textos[canal].titulo || titulo || 'AgroPeças MT',
    corpo: textos[canal].corpo || mensagem || null,
    link: typeof payload.link === 'string' ? payload.link.slice(0, 500) : null,
    dados: payload,
    referencia_tipo: entidade || null,
    referencia_id: entidadeId || null,
    /* `sistema` já está entregue no instante em que a linha existe — a tela
       lê do banco. E-mail só é "enviado" quando o job confirmar */
    enviada_em: canal === 'sistema' ? agora : null,
  }));

  const criadas = await db.Notificacao.bulkCreate(linhas, { returning: true });

  const noSistema = criadas.find((linha) => linha.canal === 'sistema');
  if (noSistema) {
    /* ordem importa: o contador é corrigido ANTES do evento, senão o front
       recebe "notificação nova" e busca um contador ainda desatualizado */
    const contagem = await contadorService.atualizarEEmitir(usuarioId);

    tempoReal.paraUsuario(usuarioId, tempoReal.EVENTOS.NOTIFICACAO_NOVA, {
      notificacao: mapper.notificacao(noSistema),
      naoLidas: contagem.naoLidas,
    });
  }

  const porEmail = criadas.find((linha) => linha.canal === 'email');
  if (porEmail) await encadearEmail({ usuario, linha: porEmail, textos });

  return { criadas: criadas.map(mapper.notificacao), ignorados };
}

/**
 * E-mail vai para a fila de e-mail, nunca sai daqui.
 *
 * Chamar o provider direto amarraria a criação da notificação ao tempo de
 * resposta de um sistema de terceiro — e um SMTP lento atrasaria o sininho,
 * que não depende dele para nada. A fila `email` também traz a retentativa com
 * espera exponencial que este service não tem como oferecer.
 */
async function encadearEmail({ usuario, linha, textos }) {
  if (!usuario.email) return null;

  return filas
    .enfileirar(
      'email.enviar',
      {
        para: usuario.email,
        assunto: textos.email?.assunto || linha.titulo,
        texto: linha.corpo,
        html: textos.email?.corpoHtml || undefined,
      },
      /* a chave única evita que uma retentativa do job de notificação, ou dois
         módulos disparando o mesmo aviso, mandem dois e-mails idênticos */
      { chaveUnica: `notificacao:${linha.id}` }
    )
    .catch((erro) => {
      console.error('[notificacao] falha ao enfileirar e-mail:', erro.message);
      return null;
    });
}

module.exports = { criar, limparDados, CHAVES_PROIBIDAS };
