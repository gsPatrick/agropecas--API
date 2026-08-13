'use strict';

const planoAdmin = require('../../plano/plano.admin.service');
const planoConsulta = require('../../plano/plano.consulta.service');
const assinatura = require('../../plano/plano.assinatura.service');
const planoMapper = require('../../plano/plano.mapper');

/**
 * Planos pela tela do Admin.
 *
 * Cada função aqui é uma linha de composição sobre `features/plano`. O que
 * justifica o arquivo existir não é o código — é o CONTRATO: a tela do painel
 * enxerga o catálogo inteiro (inclusive plano inativo e plano oculto, que a
 * vitrine esconde) e traz o número de assinantes junto, porque a pergunta que
 * o Admin faz antes de mexer num plano é sempre "quantas contas isso atinge?".
 *
 * Nenhuma regra de plano mora aqui: "não desativa o padrão", "não remove com
 * assinante ativo", "limite ausente é ilimitado" continuam em
 * `plano.admin.service`, onde valem também para o job da fila e para qualquer
 * outra porta de entrada.
 */

/**
 * Catálogo administrativo.
 *
 * `incluirInativos` e `incluirOcultos` são fixos em `true`: o Admin que não vê
 * o plano inativo não tem como reativá-lo, e "sumiu da tela" é a explicação
 * mais cara de suporte que existe.
 *
 * O total de assinantes vem de UMA consulta por plano listado — são poucos
 * planos e a contagem é indexada. Um `count` dentro do laço de assinantes
 * seria N+1; aqui o N é o número de planos (unidades), não o de contas.
 */
async function listar() {
  const planos = await planoConsulta.listar({ incluirInativos: true, incluirOcultos: true });

  const assinantes = await Promise.all(planos.map((plano) => assinatura.contarVigentes(plano.id)));

  return planos.map((plano, indice) => ({
    ...planoMapper.planoAdmin(plano),
    assinantesVigentes: assinantes[indice],
  }));
}

/** auditado por `plano.admin.service` (acao=criar, entidade=plano) */
async function criar(contexto, dados) {
  const plano = await planoAdmin.criar(dados, contexto);
  return planoMapper.planoAdmin(plano);
}

async function editar(contexto, id, dados) {
  const plano = await planoAdmin.editar(id, dados, contexto);
  return planoMapper.planoAdmin(plano);
}

/**
 * Substituição completa dos limites — não é merge, e isso é decisão da
 * feature: ver o comentário em `plano.admin.service.definirLimites`.
 */
async function definirLimites(contexto, id, limites) {
  const plano = await planoAdmin.definirLimites(id, limites, contexto);
  return planoMapper.planoAdmin(plano);
}

async function remover(contexto, id, { motivo } = {}) {
  return planoAdmin.remover(id, contexto, { motivo });
}

/**
 * Coloca um usuário num plano.
 *
 * `usuarioId` vem do corpo porque a operação é justamente sobre outra conta —
 * é a exceção consciente à regra "id nunca vem do corpo" (padrão §11.2), e ela
 * só é segura porque a rota exige `plano.atribuir.todos` e a assinatura grava
 * `em_nome_de` na auditoria.
 */
async function atribuir(contexto, { usuarioId, planoId, planoChave, motivo, fimEm }) {
  const nova = await assinatura.atribuir(
    { usuarioId, planoId, planoChave, motivo, origem: 'admin', fimEm: fimEm || null },
    contexto
  );

  return planoMapper.assinatura(nova);
}

module.exports = { listar, criar, editar, definirLimites, remover, atribuir };
