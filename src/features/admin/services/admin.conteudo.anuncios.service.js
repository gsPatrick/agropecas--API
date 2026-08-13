'use strict';

const { Op } = require('sequelize');
const db = require('../../../models');
const filas = require('../../../filas');
const { erros } = require('../../../utils/erros');

const edicaoService = require('../../anuncio/anuncio.edicao.service');
const retiradaService = require('../../anuncio/anuncio.retirada.service');
const criacaoService = require('../../anuncio/anuncio.criacao.service');
const publicacaoService = require('../../anuncio/anuncio.publicacao.service');
const acessoService = require('../../anuncio/anuncio.acesso.service');
const campos = require('../../anuncio/anuncio.campos');
const filaService = require('../../moderacao/moderacao.fila.service');
const { exigirMotivo } = require('../../moderacao/moderacao.comum');

const { lerFiltros } = require('../helpers/admin.consulta.helper');
const { paraTerceiro } = require('../helpers/admin.contexto.helper');
const { registrarAcao } = require('../helpers/admin.auditoria.helper');
const compartilhado = require('./admin.shared');

/**
 * Anúncios vistos de cima: listagem cruzada, ficha, edição e remoção.
 *
 * **Composição, não cópia.** Editar continua sendo `anuncio.edicao.service`,
 * remover continua sendo `anuncio.retirada.service`, criar continua sendo
 * `anuncio.criacao.service`. Reimplementar aqui a mesma regra garantiria que
 * um dia as duas versões divergissem — e a que ficaria errada seria justamente
 * a do Admin, que ninguém exercita no dia a dia.
 *
 * O que este arquivo acrescenta e nenhuma feature poderia acrescentar:
 *
 *  · a listagem cruza anúncio + dono + capa numa varredura só, porque a tela
 *    do Admin pergunta "de quem é isso?" em toda linha;
 *  · a remoção administrativa **avisa o dono**, coisa que a remoção pelo
 *    próprio dono não precisa fazer;
 *  · `criarEmNomeDe`, que é o poder de intervenção que a cliente pediu: o
 *    produtor liga sem saber usar o app e o Admin cadastra por ele.
 *
 * Auditoria: cada operação daqui delega para um service que **já grava** em
 * `logs_auditoria` (e com `em_nome_de` quando o dono não é o ator). Registrar
 * de novo pelo helper duplicaria a linha e transformaria a trilha em ruído —
 * o helper é usado onde o fato administrativo não existe na feature.
 */

/**
 * Colunas da listagem.
 * `descricao` e `busca_texto` são TEXT e nenhuma linha de tabela os desenha:
 * trazê-los é pagar rede e memória por dado que ninguém lê (PADRÃO §10.3).
 */
const CAMPOS_LISTA = [
  'id',
  'codigo',
  'slug',
  'titulo',
  'tipo',
  'status',
  'moderacao_status',
  'moderado_em',
  'preco_centavos',
  'preco_a_combinar',
  'uf',
  'municipio_id',
  'usuario_id',
  'categoria_id',
  'destaque_ate',
  'criado_por_admin',
  'total_visualizacoes',
  'total_denuncias',
  'publicado_em',
  'expira_em',
  'criado_em',
];

const ORDENAVEIS = ['criado_em', 'publicado_em', 'total_denuncias', 'total_visualizacoes', 'preco_centavos'];

/** dono e capa vêm por JOIN: buscá-los por linha seriam 41 consultas numa página de 20 */
const INCLUDES = () => [
  { model: db.Usuario, as: 'usuario', attributes: ['id', 'nome', 'email', 'status'], required: false },
  {
    model: db.AnuncioFoto,
    as: 'fotos',
    attributes: ['id', 'url', 'url_thumb', 'principal'],
    where: { principal: true, bloqueada: false },
    required: false,
  },
];

/** linha da tabela — lista branca, como manda §6 do padrão */
const linha = (registro) => ({
  id: registro.id,
  codigo: registro.codigo,
  slug: registro.slug,
  titulo: registro.titulo,
  tipo: registro.tipo,
  status: registro.status,
  moderacaoStatus: registro.moderacao_status,
  moderadoEm: registro.moderado_em,
  precoCentavos: registro.preco_centavos,
  precoACombinar: registro.preco_a_combinar,
  uf: registro.uf,
  destaque: Boolean(registro.destaque_ate && new Date(registro.destaque_ate) > new Date()),
  destaqueAte: registro.destaque_ate,
  criadoPorAdmin: registro.criado_por_admin,
  totalVisualizacoes: registro.total_visualizacoes,
  totalDenuncias: registro.total_denuncias,
  publicadoEm: registro.publicado_em,
  expiraEm: registro.expira_em,
  criadoEm: registro.criado_em,
  capa: (registro.fotos || [])[0]
    ? { id: registro.fotos[0].id, url: registro.fotos[0].url, urlThumb: registro.fotos[0].url_thumb }
    : null,
  /* o dono sai sem `senha_hash`, sem `documento` e sem `ip_hash`: nem no
     painel — a lista branca é a mesma para dentro e para fora */
  dono: registro.usuario
    ? {
        id: registro.usuario.id,
        nome: registro.usuario.nome,
        email: registro.usuario.email,
        status: registro.usuario.status,
      }
    : null,
});

/**
 * Listagem administrativa: todo status, de todo mundo.
 *
 * O escopo total é exigido aqui e não na rota porque `autorizar('anuncio.ler')`
 * passa também para quem só tem `anuncio.ler.proprio` — e devolver a esse
 * usuário uma tela do painel com os anúncios dele é pior que um 403: parece
 * funcionar.
 */
async function listar(contexto, query = {}) {
  compartilhado.exigirEscopoTotal(contexto, 'anuncio.ler');

  const filtros = lerFiltros(query, { camposOrdenacao: ORDENAVEIS, ordemPadrao: 'criado_em' });

  const where = {};
  if (query.status) where.status = query.status;
  if (query.moderacaoStatus) where.moderacao_status = query.moderacaoStatus;
  if (query.tipo) where.tipo = query.tipo;
  if (query.uf) where.uf = String(query.uf).toUpperCase();
  if (query.categoriaId) where.categoria_id = query.categoriaId;
  /* `usuario_id` como FILTRO de leitura é legítimo (é a tela "anúncios deste
     cadastro"); o que nunca vem do cliente é o `usuario_id` de uma ESCRITA */
  if (query.usuarioId) where.usuario_id = query.usuarioId;
  if (query.criadoPorAdmin !== undefined) where.criado_por_admin = query.criadoPorAdmin;

  if (filtros.periodo) {
    where.criado_em = { [Op.gte]: filtros.periodo.inicio, [Op.lte]: filtros.periodo.fim };
  }

  /* busca por código é exata: o suporte recebe o código pelo telefone e digitar
     um LIKE sobre ele custaria varredura sem ganho nenhum */
  if (filtros.busca) {
    where[Op.or] = [
      { codigo: filtros.busca.toUpperCase() },
      { titulo: { [Op.iLike]: `%${filtros.busca}%` } },
    ];
  }

  const { rows, count } = await db.Anuncio.findAndCountAll({
    where,
    attributes: CAMPOS_LISTA,
    include: INCLUDES(),
    order: filtros.ordem,
    offset: filtros.offset,
    limit: filtros.limit,
    /* `fotos` é 1-N: sem `distinct` a contagem somaria as linhas do JOIN */
    distinct: true,
    subQuery: false,
  });

  return { itens: rows.map(linha), pagina: filtros.pagina, porPagina: filtros.porPagina, total: count };
}

/**
 * Ficha do anúncio na mesa do Admin.
 *
 * Reaproveita `moderacao.fila.service.ver`, que já traz o dono e a contagem de
 * denúncias abertas agregada no banco (`GROUP BY`, não em JavaScript). Montar
 * uma segunda consulta equivalente aqui seria manter dois SQLs para a mesma
 * pergunta.
 */
async function ver(contexto, id) {
  const anuncio = await filaService.ver(contexto, id);
  if (!anuncio) throw erros.naoEncontrado('Anúncio');

  return {
    ...linha(anuncio),
    descricao: anuncio.descricao,
    moderacaoMotivo: anuncio.moderacao_motivo,
    denunciasAbertas: Number(anuncio.get('denuncias_abertas') || 0),
    fotos: (anuncio.fotos || [])
      .sort((a, b) => a.ordem - b.ordem)
      .map((foto) => ({
        id: foto.id,
        url: foto.url,
        ordem: foto.ordem,
        principal: foto.principal,
        bloqueada: foto.bloqueada,
      })),
  };
}

/** edição administrativa — a regra e a trilha continuam sendo as da feature */
async function editar(contexto, id, dados) {
  const anuncio = await edicaoService.editar(contexto, id, dados);
  return ver(contexto, anuncio.id);
}

/**
 * Remoção pelo Admin.
 *
 * Três diferenças em relação à remoção pelo dono, e as três são pedidas:
 * **motivo obrigatório** (é ato da plataforma sobre conteúdo alheio),
 * **soft delete** (a linha continua existindo para conversa, denúncia e
 * auditoria apontarem para algo) e **aviso ao dono** — poder amplo com aviso é
 * intervenção; sem aviso, é surpresa.
 */
async function remover(contexto, id, { motivo } = {}) {
  const justificativa = exigirMotivo(motivo);

  /* carregado ANTES: depois do soft delete o registro some das consultas e o
     título da notificação viria vazio */
  const anuncio = await acessoService.paraAcao(contexto, id, 'anuncio.remover');
  const { usuario_id: donoId, titulo } = anuncio;

  /* o service da feature faz o soft delete, o histórico e a auditoria (com
     `em_nome_de` quando o dono não é o ator) */
  await retiradaService.remover(contexto, id, { motivo: justificativa });

  if (String(donoId) !== String(contexto.usuarioId)) {
    await filas.enfileirar('notificacao.criar', {
      usuarioId: donoId,
      tipo: 'sistema',
      titulo: 'Seu anúncio foi removido',
      mensagem: `O anúncio "${titulo}" foi removido pela administração. Motivo: ${justificativa}`,
      dados: { anuncioId: id, motivo: justificativa },
      entidade: 'anuncios',
      entidadeId: id,
      canais: ['sistema'],
    });
  }

  return { removido: true, id, motivo: justificativa };
}

/**
 * Publicar em nome do anunciante (Maturacao/05, §2.4).
 *
 * O caso real: o produtor liga porque não conseguiu subir a foto e pede que o
 * cadastro seja feito por ele. O anúncio nasce com `usuario_id` do PRODUTOR —
 * é dele, ele edita, ele renova, e a quota consumida é a dele. Quem carrega o
 * rastro é a auditoria: ator = Admin, `em_nome_de` = produtor, mais a coluna
 * `criado_por_admin` no próprio anúncio.
 *
 * `paraTerceiro` é quem exige `admin.agir_em_nome_de`: representar é poder
 * separado de criar, e quem não o tem não passa daqui mesmo tendo
 * `anuncio.criar_em_nome_de`.
 */
async function criarEmNomeDe(contexto, corpo = {}) {
  const alvoId = corpo.usuarioId || corpo.emNomeDeUsuarioId;
  const dados = corpo.anuncio || corpo;

  if (!alvoId) throw erros.validacao({ usuarioId: 'Informe de quem será o anúncio.' });
  if (String(alvoId) === String(contexto.usuarioId)) {
    throw erros.validacao({ usuarioId: 'Para o próprio anúncio use a rota comum de criação.' });
  }

  const comRepresentacao = paraTerceiro(contexto, alvoId);

  const anuncio = await criacaoService.criar(comRepresentacao, {
    ...dados,
    emNomeDeUsuarioId: alvoId,
  });

  /* publicar é opcional: às vezes o Admin só monta o rascunho e o dono revisa
     antes de entrar no ar. Quando publica, a completude e a quota conferidas
     são as do DONO — `anuncio.publicacao.service` já cuida disso */
  if (dados.publicar === true) {
    await publicacaoService.publicar(comRepresentacao, anuncio.id);
  }

  /* a criação já foi auditada pela feature (ator = Admin, `em_nome_de` = o
     produtor). Esta linha existe pelo MOTIVO: criar conteúdo no nome de outra
     pessoa é o caso em que a trilha mais é consultada depois, e "por que" não
     cabe no registro genérico de criação */
  await registrarAcao(comRepresentacao, {
    acao: 'criar',
    entidade: 'anuncios',
    entidadeId: anuncio.id,
    motivo: corpo.motivo || 'cadastro_em_nome_do_anunciante',
    depois: { codigo: anuncio.codigo, titulo: anuncio.titulo, usuario_id: alvoId },
  });

  await filas.enfileirar('notificacao.criar', {
    usuarioId: alvoId,
    tipo: 'sistema',
    titulo: 'Um anúncio foi cadastrado para você',
    mensagem: `O anúncio "${anuncio.titulo}" foi cadastrado pela administração a seu pedido.`,
    dados: { anuncioId: anuncio.id },
    entidade: 'anuncios',
    entidadeId: anuncio.id,
    canais: ['sistema'],
  });

  await campos.invalidar(anuncio.id);

  return ver(contexto, anuncio.id);
}

module.exports = { listar, ver, editar, remover, criarEmNomeDe, linha, CAMPOS_LISTA };
