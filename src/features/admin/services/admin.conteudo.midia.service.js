'use strict';

const db = require('../../../models');
const filas = require('../../../filas');
const { erros } = require('../../../utils/erros');

const consultaMidia = require('../../midia/midia.consulta.service');
const remocaoMidia = require('../../midia/midia.remocao.service');
const midiaMapper = require('../../midia/midia.mapper');
const conteudoModeracao = require('../../moderacao/moderacao.conteudo.service');
const moderacaoMapper = require('../../moderacao/moderacao.mapper');
const { exigirMotivo } = require('../../moderacao/moderacao.comum');

const { registrarAcao } = require('../helpers/admin.auditoria.helper');
const { lerFiltros } = require('../helpers/admin.consulta.helper');

/**
 * Arquivos e imagens vistos pelo painel.
 *
 * O inventário e a remoção continuam sendo do módulo `midia` — ele é quem sabe
 * que uma imagem tem variantes no disco e que apagar a linha sem apagar os
 * bytes deixa lixo permanente no storage. Aqui só se acrescenta o que a mesa
 * do Admin exige e a feature não tem por que saber: **motivo obrigatório** e
 * **aviso ao dono**.
 *
 * O bloqueio de foto mora neste arquivo, e não no de moderação, porque o que
 * ele resolve é um problema de MÍDIA: o anúncio é legítimo e uma das oito
 * imagens não é. Derrubar o anúncio inteiro por causa dela puniria o vendedor
 * por um erro que ele corrige em trinta segundos.
 */

/** listagem do inventário — escopo, paginação e variantes são do service da feature */
async function listar(contexto, query = {}) {
  /* o teto do painel é mais generoso que o público, mas continua sendo teto:
     `porPagina=99999` sobre a tabela que mais cresce é o jeito mais fácil de
     derrubar o banco */
  const filtros = lerFiltros(query);

  const { itens, paginacao } = await consultaMidia.listar(contexto, {
    ...query,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
  });

  return { itens: midiaMapper.lista(itens), ...paginacao };
}

/**
 * Remoção administrativa de um arquivo.
 *
 * O escopo (`arquivo.remover` com dono conhecido) é conferido dentro do
 * service da feature. O que este acrescenta é a justificativa gravada e o
 * aviso: uma imagem que some da conta de alguém sem explicação é chamado de
 * suporte garantido — e, sem motivo na trilha, chamado que ninguém consegue
 * responder.
 */
async function remover(contexto, id, { motivo } = {}) {
  const justificativa = exigirMotivo(motivo);

  /* o dono é lido antes: depois da remoção a linha está soft-deleted e some
     das consultas normais */
  const arquivo = await db.Arquivo.findByPk(id, {
    attributes: ['id', 'usuario_id', 'nome_original'],
  });
  if (!arquivo) throw erros.naoEncontrado('Arquivo');

  const resultado = await remocaoMidia.remover(contexto, id);

  const alheio = String(arquivo.usuario_id) !== String(contexto.usuarioId);

  /* a feature grava a própria linha ("remocao_administrativa"), sem o texto
     que o Admin escreveu; esta linha é a que guarda a justificativa e a
     representação — é ela que o suporte lê */
  await registrarAcao(contexto, {
    acao: 'remover',
    entidade: 'arquivos',
    entidadeId: arquivo.id,
    emNomeDe: alheio ? arquivo.usuario_id : null,
    motivo: justificativa,
    antes: { nome_original: arquivo.nome_original, usuario_id: arquivo.usuario_id },
  });

  if (alheio) {
    await filas.enfileirar('notificacao.criar', {
      usuarioId: arquivo.usuario_id,
      tipo: 'sistema',
      titulo: 'Um arquivo seu foi removido',
      mensagem: `Um arquivo enviado por você foi removido pela administração. Motivo: ${justificativa}`,
      dados: { arquivoId: arquivo.id, motivo: justificativa },
      entidade: 'arquivos',
      entidadeId: arquivo.id,
      canais: ['sistema'],
    });
  }

  return { ...resultado, motivo: justificativa };
}

/**
 * Bloqueia UMA imagem do anúncio.
 *
 * Delegado inteiro: o service da feature exige motivo, tira a imagem da capa,
 * grava histórico do anúncio, audita e avisa o dono. Repetir qualquer uma
 * dessas cinco coisas aqui seria a chance de fazer diferente.
 */
const bloquearFoto = async (contexto, id, { motivo } = {}) =>
  moderacaoMapper.foto(await conteudoModeracao.bloquearFoto(contexto, id, { motivo }));

module.exports = { listar, remover, bloquearFoto };
