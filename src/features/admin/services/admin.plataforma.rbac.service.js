'use strict';

const { Op } = require('sequelize');
const db = require('../../../models');
const { erros } = require('../../../utils/erros');
const { CORINGA, temPermissao } = require('../../../rbac');
const { registrarAcao } = require('../helpers/admin.auditoria.helper');

/**
 * RBAC PELA TELA — papéis e permissões editáveis sem deploy.
 *
 * É a flexibilidade que a cliente pediu ("quero poder criar um perfil de
 * moderador de fotos sem chamar o programador") e, ao mesmo tempo, a superfície
 * mais perigosa do painel: quem edita papel edita quem pode o quê, inclusive a
 * si mesmo. Um erro aqui não dá erro na tela — dá poder a mais para alguém, ou
 * tranca a plataforma inteira do lado de fora.
 *
 * Daí as CINCO TRAVAS deste arquivo. Elas não são validação de formulário; são
 * as invariantes que precisam continuar verdadeiras depois de qualquer
 * operação:
 *
 *   1. papel de sistema não é removido nem tem a chave trocada;
 *   2. ninguém retira as próprias permissões de administração;
 *   3. ninguém concede permissão que não tem (senão `rbac.editar_papel`
 *      viraria autopromoção a Admin em dois cliques);
 *   4. sempre resta pelo menos um usuário com o coringa `*`;
 *   5. tudo é auditado com antes e depois.
 *
 * SOBRE O SINCRONIZADOR (`src/rbac/sincronizar.js`): o que é feito aqui
 * SOBREVIVE ao deploy. O sincronizador é `findOrCreate` puro — ele cria o que
 * falta e nunca apaga papel criado na tela nem vínculo concedido à mão;
 * permissão que saiu do código é apenas relatada como obsoleta. O catálogo do
 * código é o piso, esta tela é o teto. A contrapartida: papel de sistema
 * RECEBE de volta, no próximo `rbac:sync`, qualquer permissão do catálogo que
 * tenha sido tirada por aqui — por isso tirar permissão de papel de sistema é
 * mudança de código, não de tela.
 */

/**
 * Permissões que caracterizam "administrar a plataforma".
 *
 * A trava 2 usa esta lista para impedir o clássico: o Admin edita o próprio
 * papel, tira `rbac.editar_papel` por engano e descobre que não consegue mais
 * devolver. Não há caminho de volta pela API — só por SQL.
 */
const ADMINISTRACAO = [
  CORINGA,
  'admin.acessar',
  'rbac.ler',
  'rbac.criar_papel',
  'rbac.editar_papel',
  'rbac.remover_papel',
  'rbac.atribuir_papel',
];

const ATRIBUTOS_PAPEL = ['id', 'chave', 'nome', 'descricao', 'sistema', 'criado_em'];
const ATRIBUTOS_PERMISSAO = ['id', 'chave', 'recurso', 'acao', 'escopo', 'descricao'];

/** chave de papel: minúscula, sem espaço, sem ponto — é usada em `temPapel()` */
const normalizarChave = (valor) =>
  String(valor || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

/* ─── LISTA BRANCA DE SAÍDA ────────────────────────────────── */

const permissaoJson = (registro) => ({
  chave: registro.chave,
  recurso: registro.recurso,
  acao: registro.acao,
  escopo: registro.escopo,
  descricao: registro.descricao || null,
});

const papelJson = (registro, { usuarios = null } = {}) => ({
  id: registro.id,
  chave: registro.chave,
  nome: registro.nome,
  descricao: registro.descricao || null,
  /* a tela precisa saber para desabilitar o botão de remover — e para explicar
     por quê, em vez de deixar o Admin descobrir com um 409 */
  sistema: Boolean(registro.sistema),
  permissoes: (registro.permissoes || []).map((permissao) => permissao.chave).sort(),
  totalPermissoes: (registro.permissoes || []).length,
  ...(usuarios === null ? {} : { totalUsuarios: usuarios }),
});

/* ─── LEITURA ──────────────────────────────────────────────── */

/**
 * Papéis com as permissões de cada um.
 *
 * `through: { attributes: [] }` porque a tabela de junção não tem nada a
 * dizer, e sem isso o Sequelize traz as colunas dela em cada permissão de cada
 * papel. A contagem de usuários vem de UM `count` agrupado — não de um count
 * por papel dentro do laço, que é o N+1 clássico desta tela.
 */
async function listarPapeis() {
  const [papeis, contagem] = await Promise.all([
    db.Papel.findAll({
      attributes: ATRIBUTOS_PAPEL,
      include: [
        {
          model: db.Permissao,
          as: 'permissoes',
          attributes: ['chave'],
          through: { attributes: [] },
          required: false,
        },
      ],
      order: [['sistema', 'DESC'], ['chave', 'ASC']],
    }),
    db.UsuarioPapel.count({ group: ['papel_id'], col: 'usuario_id', distinct: true }),
  ]);

  const usuariosPorPapel = new Map(
    (contagem || []).map((linha) => [String(linha.papel_id), Number(linha.count)])
  );

  return papeis.map((papel) => papelJson(papel, { usuarios: usuariosPorPapel.get(String(papel.id)) || 0 }));
}

/**
 * Catálogo de permissões, agrupado por recurso.
 *
 * A fonte é o BANCO e não `rbac/permissoes.js`: o banco tem o catálogo do
 * código (o sincronizador o espelha) mais o que existir de legado ainda em
 * uso. Ler do código esconderia da tela justamente a permissão obsoleta que
 * alguém precisa remover de um papel.
 */
async function listarPermissoes() {
  const permissoes = await db.Permissao.findAll({
    attributes: ATRIBUTOS_PERMISSAO,
    order: [['recurso', 'ASC'], ['chave', 'ASC']],
  });

  const porRecurso = permissoes.reduce((acumulado, permissao) => {
    (acumulado[permissao.recurso] = acumulado[permissao.recurso] || []).push(permissaoJson(permissao));
    return acumulado;
  }, {});

  return { total: permissoes.length, porRecurso };
}

/* ─── APOIO DAS TRAVAS ─────────────────────────────────────── */

async function carregarPapel(id) {
  const papel = await db.Papel.findByPk(id, {
    attributes: ATRIBUTOS_PAPEL,
    include: [
      {
        model: db.Permissao,
        as: 'permissoes',
        attributes: ['id', 'chave'],
        through: { attributes: [] },
        required: false,
      },
    ],
  });

  if (!papel) throw erros.naoEncontrado('Papel');
  return papel;
}

/** resolve chaves → registros, recusando chave que não existe no catálogo */
async function resolverPermissoes(chaves) {
  const pedidas = [...new Set((chaves || []).map((chave) => String(chave).trim()).filter(Boolean))];
  if (!pedidas.length) return [];

  const registros = await db.Permissao.findAll({
    where: { chave: { [Op.in]: pedidas } },
    attributes: ['id', 'chave'],
  });

  const encontradas = new Set(registros.map((registro) => registro.chave));
  const ausentes = pedidas.filter((chave) => !encontradas.has(chave));

  /* recusar em vez de ignorar: uma permissão digitada errada que some em
     silêncio faz o Admin acreditar que concedeu algo que não concedeu */
  if (ausentes.length) {
    throw erros.validacao({ permissoes: `Permissões inexistentes: ${ausentes.join(', ')}.` });
  }

  return registros;
}

/**
 * TRAVA 3 — ninguém concede o que não tem.
 *
 * Sem ela, qualquer papel com `rbac.editar_papel` é equivalente ao coringa: o
 * moderador cria um papel com `*`, atribui a si mesmo e vira Admin sem que
 * nada na trilha pareça errado. A checagem é por chave EXATA (`temPermissao`)
 * e não por `pode()`, porque conceder `anuncio.editar.todos` tendo apenas
 * `anuncio.editar.proprio` é exatamente a escalada que queremos barrar.
 *
 * Quem tem o coringa passa em tudo — é o que `temPermissao` já faz.
 */
function garantirQuePodeConceder(contexto, chaves) {
  const faltando = chaves.filter((chave) => !temPermissao(contexto, chave));
  if (!faltando.length) return;

  throw erros.semPermissao(
    'Você não pode conceder permissão que você mesmo não tem.',
    { permissoes: faltando.slice(0, 20) }
  );
}

/** permissões que o contexto ganha por CADA papel seu, lidas do banco */
async function permissoesDosPapeisDoAtor(contexto) {
  const chavesDePapel = contexto?.papeis || [];
  if (!chavesDePapel.length) return new Map();

  const papeis = await db.Papel.findAll({
    where: { chave: { [Op.in]: chavesDePapel } },
    attributes: ['id', 'chave'],
    include: [
      {
        model: db.Permissao,
        as: 'permissoes',
        attributes: ['chave'],
        through: { attributes: [] },
        required: false,
      },
    ],
  });

  return new Map(
    papeis.map((papel) => [String(papel.id), new Set((papel.permissoes || []).map((p) => p.chave))])
  );
}

/**
 * TRAVA 2 — o Admin não se desliga do poder por engano.
 *
 * Simula o estado FINAL: se, depois da mudança, alguma permissão de
 * administração que o ator tem hoje deixar de existir em todos os papéis dele,
 * a operação é recusada. Recusar e não avisar: uma confirmação ("tem certeza?")
 * não resolve, porque o clique errado continua possível e não há desfazer pela
 * API.
 */
async function garantirQueNaoSeDesarma(contexto, { papelId, chavesFinais }) {
  const porPapel = await permissoesDosPapeisDoAtor(contexto);
  if (!porPapel.has(String(papelId))) return; // o papel não é do ator: nada a proteger

  const antes = new Set();
  porPapel.forEach((chaves) => chaves.forEach((chave) => antes.add(chave)));

  const depois = new Set();
  porPapel.forEach((chaves, id) => {
    if (String(id) === String(papelId)) {
      (chavesFinais || []).forEach((chave) => depois.add(chave));
      return;
    }
    chaves.forEach((chave) => depois.add(chave));
  });

  const perdidas = ADMINISTRACAO.filter((chave) => antes.has(chave) && !depois.has(chave));
  if (!perdidas.length) return;

  throw erros.conflito(
    'Esta alteração retiraria de você mesmo permissões de administração. ' +
      'Peça a outro administrador, ou faça a mudança em duas etapas.',
    { permissoes: perdidas }
  );
}

/**
 * TRAVA 4 — sempre resta alguém com o coringa `*`.
 *
 * A plataforma sem nenhum portador de `*` não tem como se destravar por dentro:
 * não sobra ninguém capaz de recriar o vínculo. É a única falha deste módulo
 * que exige acesso ao banco para consertar, então ela é verificada ANTES de
 * qualquer escrita que possa causá-la.
 *
 * @param papelId       papel sendo alterado/removido
 * @param mantemCoringa o papel continuará com `*` depois da operação?
 * @param removido      o papel inteiro está sendo removido?
 */
async function garantirCoringaSobrevivente({ papelId, mantemCoringa, removido = false }) {
  const coringa = await db.Permissao.findOne({ where: { chave: CORINGA }, attributes: ['id'] });
  if (!coringa) return; // catálogo ainda não sincronizado: nada a proteger

  const vinculos = await db.PapelPermissao.findAll({
    where: { permissao_id: coringa.id },
    attributes: ['papel_id'],
    raw: true,
  });

  let papeisComCoringa = vinculos
    .map((vinculo) => String(vinculo.papel_id))
    .filter((id) => id !== String(papelId));

  if (!removido && mantemCoringa) papeisComCoringa.push(String(papelId));
  papeisComCoringa = [...new Set(papeisComCoringa)];

  const negar = () =>
    erros.conflito(
      'A plataforma ficaria sem nenhum administrador com acesso total. Conceda o coringa a outro papel ou usuário antes.',
      { permissao: CORINGA }
    );

  if (!papeisComCoringa.length) throw negar();

  const usuarios = await db.UsuarioPapel.count({
    where: { papel_id: { [Op.in]: papeisComCoringa } },
    distinct: true,
    col: 'usuario_id',
  });

  if (!usuarios) throw negar();
}

/** TRAVA 1 — papel de sistema é intocável na identidade e indestrutível */
function garantirNaoSistema(papel, { operacao }) {
  if (!papel.sistema) return;

  throw erros.conflito(
    `O papel "${papel.chave}" é do sistema e não pode ser ${operacao}. ` +
      'Remover o papel de administrador deixaria a plataforma sem dono, sem caminho de volta.',
    { papel: papel.chave, sistema: true }
  );
}

/* ─── ESCRITA ──────────────────────────────────────────────── */

/**
 * Cria papel.
 *
 * Nasce sempre com `sistema: false`, ignorando o que vier no corpo: papel de
 * sistema é conceito do catálogo em código (`rbac/papeis.js`), e permitir
 * criar um pela tela produziria um papel indestrutível que nenhum deploy
 * conhece.
 */
async function criarPapel(contexto, { chave, nome, descricao, permissoes = [] }) {
  const chaveNormalizada = normalizarChave(chave);
  if (!chaveNormalizada) throw erros.validacao({ chave: 'Informe a chave do papel.' });

  const existente = await db.Papel.findOne({ where: { chave: chaveNormalizada }, attributes: ['id'] });
  if (existente) throw erros.conflito('Já existe um papel com esta chave.', { chave: chaveNormalizada });

  const registros = await resolverPermissoes(permissoes);
  garantirQuePodeConceder(contexto, registros.map((registro) => registro.chave));

  const papel = await db.sequelize.transaction(async (transacao) => {
    const criado = await db.Papel.create(
      { chave: chaveNormalizada, nome: nome || chaveNormalizada, descricao: descricao || null, sistema: false },
      { transaction: transacao }
    );

    if (registros.length) {
      await db.PapelPermissao.bulkCreate(
        registros.map((registro) => ({ papel_id: criado.id, permissao_id: registro.id })),
        { transaction: transacao }
      );
    }

    return criado;
  });

  await registrarAcao(contexto, {
    acao: 'criar',
    entidade: 'papel',
    entidadeId: papel.id,
    depois: { chave: papel.chave, nome: papel.nome, permissoes: registros.map((r) => r.chave) },
  });

  return papelJson(await carregarPapel(papel.id), { usuarios: 0 });
}

/**
 * Edita papel — nome, descrição e, quando `permissoes` vem, o CONJUNTO
 * completo de permissões (substituição, não merge).
 *
 * Substituir e não somar: a tela mostra uma lista de caixas marcadas, e o que
 * o Admin vê ali tem de ser o que vale. Uma API que só sabe somar deixa
 * permissão fantasma que a tela não consegue tirar.
 */
async function editarPapel(contexto, id, { nome, descricao, chave, permissoes }) {
  const papel = await carregarPapel(id);

  /* TRAVA 1: a chave é o que `temPapel()` e o catálogo do código usam para
     reconhecer o papel — trocá-la em papel de sistema desliga silenciosamente
     as permissões que o sincronizador reaplica a cada deploy */
  if (chave && normalizarChave(chave) !== papel.chave) {
    if (papel.sistema) garantirNaoSistema(papel, { operacao: 'renomeado na chave' });

    const conflito = await db.Papel.findOne({ where: { chave: normalizarChave(chave) }, attributes: ['id'] });
    if (conflito) throw erros.conflito('Já existe um papel com esta chave.');
  }

  const chavesAtuais = (papel.permissoes || []).map((permissao) => permissao.chave);
  const alteraPermissoes = Array.isArray(permissoes);

  let registros = [];
  let chavesFinais = chavesAtuais;

  if (alteraPermissoes) {
    registros = await resolverPermissoes(permissoes);
    chavesFinais = registros.map((registro) => registro.chave);

    const adicionadas = chavesFinais.filter((chaveNova) => !chavesAtuais.includes(chaveNova));

    garantirQuePodeConceder(contexto, adicionadas);
    await garantirQueNaoSeDesarma(contexto, { papelId: papel.id, chavesFinais });
    await garantirCoringaSobrevivente({
      papelId: papel.id,
      mantemCoringa: chavesFinais.includes(CORINGA),
    });
  }

  const antes = {
    chave: papel.chave,
    nome: papel.nome,
    descricao: papel.descricao,
    permissoes: [...chavesAtuais].sort(),
  };

  await db.sequelize.transaction(async (transacao) => {
    await papel.update(
      {
        ...(nome === undefined ? {} : { nome }),
        ...(descricao === undefined ? {} : { descricao }),
        ...(chave && !papel.sistema ? { chave: normalizarChave(chave) } : {}),
      },
      { transaction: transacao }
    );

    if (!alteraPermissoes) return;

    await db.PapelPermissao.destroy({ where: { papel_id: papel.id }, transaction: transacao });
    if (registros.length) {
      await db.PapelPermissao.bulkCreate(
        registros.map((registro) => ({ papel_id: papel.id, permissao_id: registro.id })),
        { transaction: transacao }
      );
    }
  });

  const atualizado = await carregarPapel(papel.id);

  await registrarAcao(contexto, {
    acao: 'editar',
    entidade: 'papel',
    entidadeId: papel.id,
    antes,
    depois: {
      chave: atualizado.chave,
      nome: atualizado.nome,
      descricao: atualizado.descricao,
      permissoes: (atualizado.permissoes || []).map((permissao) => permissao.chave).sort(),
    },
  });

  return papelJson(atualizado);
}

/**
 * Remove papel.
 *
 * Remoção física do papel e dos vínculos, em transação: `papeis` não é
 * paranoid, e deixar `usuario_papeis` apontando para papel apagado faria
 * `montarContexto` montar contexto com papel nulo.
 */
async function removerPapel(contexto, id) {
  const papel = await carregarPapel(id);

  garantirNaoSistema(papel, { operacao: 'removido' });

  const chavesAtuais = (papel.permissoes || []).map((permissao) => permissao.chave);

  /* remover o papel é o caso extremo de "retirar permissões": se ele for do
     próprio ator, as travas 2 e 4 valem igual */
  await garantirQueNaoSeDesarma(contexto, { papelId: papel.id, chavesFinais: [] });
  await garantirCoringaSobrevivente({ papelId: papel.id, mantemCoringa: false, removido: true });

  const totalUsuarios = await db.UsuarioPapel.count({ where: { papel_id: papel.id } });

  await db.sequelize.transaction(async (transacao) => {
    await db.PapelPermissao.destroy({ where: { papel_id: papel.id }, transaction: transacao });
    await db.UsuarioPapel.destroy({ where: { papel_id: papel.id }, transaction: transacao });
    await papel.destroy({ transaction: transacao });
  });

  await registrarAcao(contexto, {
    acao: 'remover',
    entidade: 'papel',
    entidadeId: papel.id,
    antes: { chave: papel.chave, nome: papel.nome, permissoes: chavesAtuais.sort(), usuarios: totalUsuarios },
    depois: null,
  });

  return { removido: true, id: papel.id, chave: papel.chave, usuariosAfetados: totalUsuarios };
}

module.exports = {
  listarPapeis,
  listarPermissoes,
  criarPapel,
  editarPapel,
  removerPapel,
  ADMINISTRACAO,
  normalizarChave,
};
