'use strict';

/**
 * Model → JSON da API.
 *
 * A decisão que pesa aqui é **o denunciante nunca aparece**. Nem no recibo de
 * quem denunciou (ele já sabe quem é), nem na listagem de moderação por
 * padrão, nem em lugar nenhum que o denunciado possa alcançar.
 *
 * O motivo é de produto, não de zelo abstrato: o mercado de peças agrícolas em
 * MT é pequeno e as pessoas se conhecem. Se denunciar significar virar alvo de
 * retaliação comercial, ninguém denuncia — e a moderação fica cega. Quem
 * precisa da identidade para apurar (moderador, admin) usa
 * `itemComDenunciante`, que só é chamado depois de `lgpd.acessar_dado_pessoal`
 * ser exigido e a leitura ser registrada em `logs_acesso_dado`.
 */

/** o que o próprio denunciante vê em "minhas denúncias" */
const minha = (registro) => ({
  id: registro.id,
  alvoTipo: registro.alvo_tipo,
  alvoId: registro.alvo_id,
  motivo: registro.motivo,
  descricao: registro.descricao,
  status: registro.status,
  /* o desfecho é devolvido, a redação interna do moderador também: quem
     denunciou merece saber no que deu, senão denunciar parece um buraco */
  acaoTomada: registro.acao_tomada,
  resolucao: registro.resolucao,
  resolvidaEm: registro.resolvida_em,
  criadoEm: registro.criado_em,
});

/**
 * Linha da fila de moderação. `denunciante_id` e `ip_hash` ficam de fora —
 * o segundo é dado pessoal guardado para investigação, não para tela.
 */
const item = (registro) => ({
  id: registro.id,
  alvoTipo: registro.alvo_tipo,
  alvoId: registro.alvo_id,
  denunciadoId: registro.denunciado_id,
  motivo: registro.motivo,
  descricao: registro.descricao,
  evidenciaUrl: registro.evidencia_url,
  status: registro.status,
  acaoTomada: registro.acao_tomada,
  resolucao: registro.resolucao,
  resolvidaPor: registro.resolvida_por,
  resolvidaEm: registro.resolvida_em,
  criadoEm: registro.criado_em,
  /* vem da subconsulta de prioridade: quantas denúncias abertas o MESMO alvo
     acumula. É o número que ordena a fila */
  denunciasNoAlvo: Number(registro.get?.('denuncias_no_alvo') ?? registro.denuncias_no_alvo ?? 1),
});

/** só para apuração, e só depois de registrar a leitura (LGPD) */
const itemComDenunciante = (registro) => ({
  ...item(registro),
  denuncianteId: registro.denunciante_id,
});

const lista = (itens) => (itens || []).map(item);

/** agrupamento por alvo — o que a tela usa para atacar o pior caso primeiro */
const grupo = (linha) => ({
  alvoTipo: linha.alvo_tipo,
  alvoId: linha.alvo_id,
  denunciadoId: linha.denunciado_id,
  total: Number(linha.total),
  abertas: Number(linha.abertas),
  motivos: linha.motivos || [],
  primeiraEm: linha.primeira_em,
  ultimaEm: linha.ultima_em,
});

module.exports = { minha, item, itemComDenunciante, lista, grupo };
