'use strict';

const { RECURSOS } = require('./recursos');

/**
 * Catálogo de permissões, derivado dos recursos.
 *
 * Uma ação com escopos gera uma permissão por escopo:
 *   anuncio.editar.proprio · anuncio.editar.todos
 * Uma ação sem escopo gera uma permissão simples:
 *   anuncio.criar
 *
 * Derivar em vez de listar à mão evita o erro clássico: criar a ação e
 * esquecer de cadastrar a permissão correspondente.
 */

const CORINGA = '*';

function construirCatalogo() {
  const permissoes = [];

  Object.entries(RECURSOS).forEach(([recurso, definicao]) => {
    Object.entries(definicao.acoes).forEach(([acao, detalhe]) => {
      const escopos = detalhe.escopos && detalhe.escopos.length ? detalhe.escopos : [null];

      escopos.forEach((escopo) => {
        const chave = escopo ? `${recurso}.${acao}.${escopo}` : `${recurso}.${acao}`;

        permissoes.push({
          chave,
          recurso,
          acao,
          /* o banco guarda o escopo normalizado: `propria/todas` (feminino, usado
             em conversa e denúncia) é o mesmo conceito de `proprio/todos` */
          escopo: escopo ? (['proprio', 'propria'].includes(escopo) ? 'proprio' : 'todos') : 'nenhum',
          /* ação sem escopo que ainda assim é privativa de quem administra;
             ver o comentário em `propriasDoRecurso` */
          administrativa: Boolean(detalhe.administrativa),
          descricao: detalhe.descricao,
        });
      });
    });
  });

  return permissoes;
}

const PERMISSOES = construirCatalogo();

const CHAVES = PERMISSOES.map((permissao) => permissao.chave);

/** todas as permissões de um recurso — usado ao montar papéis */
function doRecurso(recurso) {
  return CHAVES.filter((chave) => chave.startsWith(`${recurso}.`));
}

/**
 * Permissões que um usuário comum recebe de um recurso: as de escopo próprio,
 * mais as sem escopo que NÃO são administrativas.
 *
 * A exclusão das administrativas não é detalhe. Sem ela, toda ação sem escopo
 * entrava aqui — e `usuario.criar`, `notificacao.template_editar` e
 * `lgpd.publicar_documento` chegaram a ficar no papel `usuario`, o que dava a
 * qualquer cadastro o poder de publicar novos Termos de Uso.
 */
function propriasDoRecurso(recurso) {
  return PERMISSOES.filter(
    (permissao) =>
      permissao.recurso === recurso &&
      permissao.escopo !== 'todos' &&
      !permissao.administrativa
  ).map((permissao) => permissao.chave);
}

module.exports = { PERMISSOES, CHAVES, CORINGA, doRecurso, propriasDoRecurso };
