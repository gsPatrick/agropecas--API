'use strict';

/**
 * Model → JSON da mesa de moderação.
 *
 * Lista branca como no resto do projeto. O que não sai daqui, e por quê:
 *   · `busca_texto` e `descricao` na linha da fila — TEXT que a tela não usa;
 *   · `ip_hash` em qualquer histórico — dado pessoal guardado para
 *     investigação, não para exibição;
 *   · `senha_hash` e `observacoes_internas` do dono — nunca, em lugar nenhum.
 */

const numero = (registro, chave) =>
  Number(registro.get?.(chave) ?? registro[chave] ?? 0);

/** dono resumido: o suficiente para o moderador decidir sem abrir outra tela */
const dono = (registro) => {
  if (!registro) return null;
  return {
    id: registro.id,
    nome: registro.nome,
    email: registro.email,
    status: registro.status,
  };
};

/** linha da fila */
const itemDaFila = (registro) => ({
  id: registro.id,
  codigo: registro.codigo,
  titulo: registro.titulo,
  slug: registro.slug,
  tipo: registro.tipo,
  status: registro.status,
  moderacaoStatus: registro.moderacao_status,
  moderacaoMotivo: registro.moderacao_motivo,
  moderadoEm: registro.moderado_em,
  precoCentavos: registro.preco_centavos,
  uf: registro.uf,
  publicadoEm: registro.publicado_em,
  criadoEm: registro.criado_em,
  denunciasAbertas: numero(registro, 'denuncias_abertas'),
  totalDenuncias: registro.total_denuncias,
  dono: dono(registro.usuario),
});

const fila = (itens) => (itens || []).map(itemDaFila);

/** detalhe do anúncio na moderação — inclui as fotos, com o flag de bloqueio */
const anuncioDetalhe = (registro) => {
  if (!registro) return null;
  return {
    ...itemDaFila(registro),
    descricao: registro.descricao,
    fotos: (registro.fotos || []).map((foto) => ({
      id: foto.id,
      url: foto.url,
      ordem: foto.ordem,
      principal: foto.principal,
      bloqueada: foto.bloqueada,
    })),
  };
};

/** resultado de uma ação sobre anúncio — o front atualiza a linha sem recarregar */
const decisao = (anuncio) => ({
  id: anuncio.id,
  codigo: anuncio.codigo,
  status: anuncio.status,
  moderacaoStatus: anuncio.moderacao_status,
  moderacaoMotivo: anuncio.moderacao_motivo,
  moderadoEm: anuncio.moderado_em,
});

const foto = (registro) => ({
  id: registro.id,
  anuncioId: registro.anuncio_id,
  bloqueada: registro.bloqueada,
  moderadaEm: registro.moderada_em,
});

/** resultado de uma sanção: o status novo e quantas sessões caíram */
const sancao = ({ usuario, sessoesEncerradas }) => ({
  id: usuario.id,
  nome: usuario.nome,
  status: usuario.status,
  suspensoAte: usuario.suspenso_ate,
  motivoStatus: usuario.motivo_status,
  sessoesEncerradas: sessoesEncerradas || 0,
});

/** linha da trilha do anúncio */
const historicoAnuncio = (registro) => ({
  id: registro.id,
  de: registro.status_anterior,
  para: registro.status_novo,
  autorId: registro.ator_id,
  autorPapel: registro.ator_papel,
  motivo: registro.motivo,
  alteracoes: registro.alteracoes,
  em: registro.criado_em,
});

/** linha da trilha de sanções da conta */
const historicoUsuario = (registro) => ({
  id: registro.id,
  acao: registro.acao,
  autorId: registro.ator_id,
  autorPapel: registro.ator_papel,
  de: registro.antes?.status ?? null,
  para: registro.depois?.status ?? null,
  motivo: registro.motivo,
  em: registro.criado_em,
});

module.exports = {
  itemDaFila,
  fila,
  anuncioDetalhe,
  decisao,
  foto,
  sancao,
  historicoAnuncio,
  historicoUsuario,
  dono,
};
