'use strict';

/**
 * Model → JSON.
 *
 * `ip_hash` e `user_agent` NÃO saem na listagem: o hash não diz nada a um
 * humano lendo a tela e, junto com o resto da linha, ajuda a correlacionar
 * sessões de terceiros — que é justamente o que a pseudonimização evita. Se um
 * dia a apuração de um incidente precisar deles, isso passa por consulta ao
 * banco com registro do acesso, não por um campo a mais na tela de todo dia.
 */

const linha = (registro) => ({
  id: registro.id,
  acao: registro.acao,
  entidade: registro.entidade,
  entidadeId: registro.entidade_id,
  ator: registro.ator
    ? { id: registro.ator.id, nome: registro.ator.nome }
    : registro.ator_id
      ? { id: registro.ator_id, nome: null }
      : null,
  atorPapel: registro.ator_papel,
  emNomeDe: registro.em_nome_de,
  motivo: registro.motivo,
  origem: registro.origem,
  criadoEm: registro.criado_em,
});

/**
 * Detalhe com o diff. `antes`/`depois` já foram mascarados na GRAVAÇÃO — não
 * aqui. Mascarar só na saída deixaria o dado em claro no banco, onde ele vive
 * cinco anos e é lido por consulta direta em qualquer apuração.
 */
const detalhe = (registro) => ({
  ...linha(registro),
  antes: registro.antes,
  depois: registro.depois,
});

const acessoDado = (registro) => ({
  id: registro.id,
  ator: registro.ator
    ? { id: registro.ator.id, nome: registro.ator.nome }
    : { id: registro.ator_id, nome: null },
  titularId: registro.titular_id,
  recurso: registro.recurso,
  recursoId: registro.recurso_id,
  motivo: registro.motivo,
  denunciaId: registro.denuncia_id,
  criadoEm: registro.criado_em,
});

module.exports = { linha, detalhe, acessoDado };
