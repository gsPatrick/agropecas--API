'use strict';

const { exigir } = require('../../../rbac');
const { erros } = require('../../../utils/erros');

const arvoreService = require('../../catalogo/catalogo.arvore.service');
const categoriaService = require('../../catalogo/catalogo.categoria.service');
const marcaService = require('../../catalogo/catalogo.marca.service');
const maquinaService = require('../../catalogo/catalogo.maquina.service');
const servicoService = require('../../catalogo/catalogo.servico.service');

const { lerFiltros } = require('../helpers/admin.consulta.helper');

/**
 * Catálogo do painel: uma rota, quatro coleções.
 *
 * `/admin/catalogo/:colecao` existe porque a TELA é uma só — o Admin abre
 * "Catálogo" e troca de aba entre categorias, marcas, máquinas e serviços. Não
 * é economia de código: as quatro coleções continuam com services próprios,
 * cada um com as suas regras de remoção segura, e este arquivo só despacha.
 *
 * ⚠️ **A PERMISSÃO É CONFERIDA AQUI, POR COLEÇÃO.**
 *
 * A rota carrega uma permissão genérica (`categoria.criar`) porque um
 * `autorizar()` estático não consegue depender de `:colecao`. Se a checagem
 * parasse ali, quem recebesse o direito de criar categoria criaria também
 * marca, máquina e serviço — uma escalada silenciosa, dentro de uma rota que
 * parece autorizada. Por isso cada operação exige `<recurso>.<acao>` da
 * coleção que ela de fato manipula, e é esta linha que separa um curador de
 * conteúdo de um administrador do catálogo.
 */

/**
 * O mapa das coleções.
 *
 * `recurso` é o prefixo da permissão no RBAC; `alvo` é quem sabe a regra. Uma
 * coleção nova é uma entrada aqui — nunca um `if` espalhado nas funções.
 */
const COLECOES = {
  categorias: {
    recurso: 'categoria',
    rotulo: 'Categoria',
    listar: (filtros, paginacao) =>
      arvoreService.buscar(
        { busca: filtros.busca, tipo: filtros.tipo, incluirInativas: true },
        paginacao
      ),
    escrita: categoriaService,
  },
  marcas: {
    recurso: 'marca',
    rotulo: 'Marca',
    listar: (filtros, paginacao) =>
      marcaService.listar(
        { busca: filtros.busca, tipo: filtros.tipo, incluirInativas: true },
        paginacao
      ),
    escrita: marcaService,
  },
  maquinas: {
    recurso: 'maquina',
    rotulo: 'Máquina',
    listar: (filtros, paginacao) =>
      maquinaService.listar(
        {
          busca: filtros.busca,
          marcaId: filtros.marcaId,
          categoriaMaquina: filtros.categoriaMaquina,
          incluirInativas: true,
        },
        paginacao
      ),
    escrita: maquinaService,
  },
  servicos: {
    recurso: 'servico',
    rotulo: 'Serviço',
    listar: (filtros, paginacao) =>
      servicoService.listar(
        { busca: filtros.busca, categoriaId: filtros.categoriaId, incluirInativos: true },
        paginacao
      ),
    escrita: servicoService,
  },
};

/**
 * Resolve a coleção e **exige a permissão dela**.
 *
 * Coleção desconhecida é 404 e não 400: `:colecao` é parte do caminho, e um
 * caminho que não existe responde como caminho que não existe.
 */
function resolver(contexto, colecao, acao) {
  const definicao = COLECOES[colecao];
  if (!definicao) throw erros.naoEncontrado('Coleção do catálogo');

  exigir(contexto, `${definicao.recurso}.${acao}`);

  return definicao;
}

/**
 * Listagem administrativa — inclui INATIVOS.
 *
 * A rota pública esconde item inativo (é rascunho de catálogo que o Admin
 * ainda não publicou); a tela de gestão precisa justamente dele. Por isso a
 * permissão exigida aqui é a de EDIÇÃO da coleção, e não a de leitura pública:
 * quem só lê não tem por que enxergar o que ainda não foi publicado.
 */
async function listar(contexto, colecao, query = {}) {
  const definicao = resolver(contexto, colecao, 'editar');
  const filtros = lerFiltros(query);

  const { itens, total } = await definicao.listar(
    {
      busca: filtros.busca,
      tipo: query.tipo,
      marcaId: query.marcaId,
      categoriaId: query.categoriaId,
      categoriaMaquina: query.categoriaMaquina,
    },
    { limit: filtros.limit, offset: filtros.offset }
  );

  return { itens, pagina: filtros.pagina, porPagina: filtros.porPagina, total, colecao };
}

/* As escritas delegam inteiras: o 409 de "esta marca está em uso", a geração
   do slug único e a invalidação do cache do catálogo são regras da feature, e
   cada uma delas já grava a própria linha em `logs_auditoria`. */

async function criar(contexto, colecao, corpo) {
  const definicao = resolver(contexto, colecao, 'criar');
  return definicao.escrita.criar(contexto, corpo);
}

async function editar(contexto, colecao, id, corpo) {
  const definicao = resolver(contexto, colecao, 'editar');
  return definicao.escrita.editar(contexto, id, corpo);
}

async function remover(contexto, colecao, id) {
  const definicao = resolver(contexto, colecao, 'remover');
  return definicao.escrita.remover(contexto, id);
}

/**
 * Reordenação em lote (a tela é drag-and-drop).
 *
 * Só categoria e serviço têm ordem manual — marca e máquina são ordenadas por
 * nome, e inventar uma ordenação para elas seria criar funcionalidade que
 * ninguém pediu. A resposta diz isso em vez de fingir sucesso.
 */
async function ordenar(contexto, colecao, itens = []) {
  const alvo = COLECOES[colecao];
  if (!alvo) throw erros.naoEncontrado('Coleção do catálogo');

  /* `marca` e `maquina` não têm a ação `ordenar` no catálogo do RBAC — pedir
     uma permissão inexistente negaria a todos menos ao coringa do Admin e
     esconderia o motivo real, que é a coleção não ser ordenável. Onde a ação
     existe, é ela que vale */
  const definicao = resolver(
    contexto,
    colecao,
    typeof alvo.escrita.ordenar === 'function' ? 'ordenar' : 'editar'
  );

  if (typeof definicao.escrita.ordenar !== 'function') {
    throw erros.invalido(`A coleção "${colecao}" não tem ordenação manual.`, {
      ordenaveis: ['categorias', 'servicos'],
    });
  }

  if (!Array.isArray(itens) || !itens.length) {
    throw erros.validacao({ itens: 'Informe a nova ordem dos itens.' });
  }

  return definicao.escrita.ordenar(contexto, itens);
}

module.exports = { listar, criar, editar, remover, ordenar, COLECOES };
