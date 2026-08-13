'use strict';

/**
 * Vocabulários fechados da feature.
 *
 * Ficam aqui, e não espalhados nos services, para que mudar o rótulo de uma
 * providência não vire caçada em quatro arquivos — e para que o validator e o
 * service leiam exatamente a mesma lista.
 */

/**
 * Motivos aceitos. É o ENUM da coluna `denuncias.motivo` (migration já
 * aplicada): esta lista é cópia de leitura, não fonte. Divergir dela faria o
 * banco recusar a linha depois da validação ter passado.
 */
const MOTIVOS = [
  'spam',
  'golpe',
  'produto_proibido',
  'produto_falsificado',
  'conteudo_ofensivo',
  'informacao_falsa',
  'duplicado',
  'outro',
];

/** status abertos: são estes que entram na fila e contam para a prioridade */
const STATUS_PENDENTES = ['aberta', 'em_analise'];

/** desfechos possíveis ao resolver — `arquivada` é o "nem procede nem pune" */
const STATUS_RESOLVIDOS = ['procedente', 'improcedente', 'arquivada'];

/**
 * Providência tomada, gravada em `denuncias.acao_tomada`.
 *
 * Vocabulário fechado porque é ele que alimenta o relatório de moderação: se
 * cada moderador escrever a providência com suas palavras, não existe como
 * responder "quantas denúncias de golpe terminaram em banimento".
 */
const ACOES_TOMADAS = [
  'nenhuma',
  'anuncio_ocultado',
  'anuncio_reprovado',
  'anuncio_removido',
  'foto_bloqueada',
  'mensagem_removida',
  'usuario_advertido',
  'usuario_suspenso',
  'usuario_banido',
  'outra',
];

/** entidade em `logs_auditoria` — mesmo nome da tabela, como no resto do projeto */
const ENTIDADE = 'denuncias';

/** rótulo do recurso em `logs_acesso_dado` quando a ficha do denunciado é aberta */
const RECURSO_ACESSO = 'denuncia_ficha';

module.exports = {
  MOTIVOS,
  STATUS_PENDENTES,
  STATUS_RESOLVIDOS,
  ACOES_TOMADAS,
  ENTIDADE,
  RECURSO_ACESSO,
};
