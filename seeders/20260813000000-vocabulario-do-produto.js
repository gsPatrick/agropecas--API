'use strict';

/**
 * Vocabulário do produto: categorias, marcas e serviços.
 *
 * É o que o **usuário escolhe** ao preencher perfil e anúncio — não é conteúdo
 * de cliente. Sem estas linhas no banco, o formulário de anúncio abre com o
 * campo de categoria vazio e o prestador não tem o que marcar em "Meus
 * serviços": as telas existem, mas não têm o que oferecer.
 *
 * Hoje essas listas estão escritas à mão no front (`lib/anuncio-form.js`,
 * `lib/exclusivas-mock.js`). Aqui elas passam a vir do banco, que é onde a
 * administração as edita em `/admin/catalogo` — sem isso, acrescentar uma
 * marca exige deploy do front.
 *
 * **Idempotente por `slug`**: rodar duas vezes não duplica e não sobrescreve o
 * que a administração já ajustou. Um seeder que reescreve tudo a cada deploy
 * apagaria justamente as decisões tomadas pela cliente.
 */

/* os modelos usam nomes de coluna em snake_case, sem `underscored`: escrever
   camelCase aqui faz o Sequelize descartar o campo em silêncio e o banco
   recusar por NOT NULL — foi exatamente o que aconteceu na primeira execução */
const db = require('../src/models');

const normalizar = (texto) =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const slugificar = (texto) =>
  normalizar(texto)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/* ── categorias ────────────────────────────────────────────────
   `tipo` separa o que aparece no anúncio de peça do que aparece no de
   serviço. As filhas existem porque "Motor" sozinho não ajuda quem procura
   junta de cabeçote — a busca precisa do segundo nível. */
const CATEGORIAS = [
  {
    nome: 'Motor',
    tipo: 'peca',
    icone: 'gear',
    destaque: true,
    filhas: ['Cabeçote', 'Pistões e camisas', 'Juntas e retentores', 'Bomba injetora', 'Turbina'],
  },
  {
    nome: 'Hidráulica',
    tipo: 'peca',
    icone: 'pump',
    destaque: true,
    filhas: ['Bomba hidráulica', 'Cilindro', 'Mangueiras e conexões', 'Comando e válvulas'],
  },
  {
    nome: 'Transmissão',
    tipo: 'peca',
    icone: 'bearing',
    filhas: ['Embreagem', 'Caixa de câmbio', 'Coroa e pinhão', 'Eixo e cardã'],
  },
  {
    nome: 'Elétrica',
    tipo: 'peca',
    icone: 'belt',
    filhas: ['Alternador', 'Motor de partida', 'Chicote e painel', 'Bateria'],
  },
  {
    nome: 'Rodado e pneus',
    tipo: 'peca',
    icone: 'bearing',
    filhas: ['Pneus agrícolas', 'Rodas e aros', 'Rolamentos', 'Freios'],
  },
  {
    nome: 'Filtros e lubrificantes',
    tipo: 'peca',
    icone: 'pump',
    filhas: ['Filtro de óleo', 'Filtro de ar', 'Filtro de combustível', 'Óleos e graxas'],
  },
  {
    nome: 'Implementos',
    tipo: 'peca',
    icone: 'tractor',
    filhas: ['Plantadeira', 'Pulverizador', 'Grade e arado', 'Colhedora'],
  },
  { nome: 'Cabine e acessórios', tipo: 'peca', icone: 'gear', filhas: ['Vidros', 'Bancos', 'Ar-condicionado'] },

  {
    nome: 'Mecânica',
    tipo: 'servico',
    icone: 'wrench',
    destaque: true,
    filhas: ['Retífica de motor', 'Transmissão', 'Revisão preventiva', 'Diagnóstico eletrônico'],
  },
  { nome: 'Hidráulica', tipo: 'servico', icone: 'pump', filhas: ['Bombas e cilindros', 'Mangueiras'] },
  { nome: 'Elétrica', tipo: 'servico', icone: 'belt', filhas: ['Sistema 12V/24V', 'Piloto automático'] },
  { nome: 'Solda e usinagem', tipo: 'servico', icone: 'wrench', filhas: ['Solda de chassi', 'Torno e fresa'] },
  { nome: 'Pulverização e plantio', tipo: 'servico', icone: 'tractor', filhas: ['Regulagem de bicos', 'Regulagem de plantadeira'] },
];

/* ── marcas ────────────────────────────────────────────────────
   `tipo` diz onde a marca aparece: só em máquina, só em peça, ou nos dois.
   "Outra" existe por necessidade de campo — sem ela, quem tem um implemento
   de fabricante pequeno não consegue concluir o cadastro. */
const MARCAS = [
  { nome: 'John Deere', tipo: 'ambos', ordem: 1 },
  { nome: 'Valtra', tipo: 'ambos', ordem: 2 },
  { nome: 'Massey Ferguson', tipo: 'ambos', ordem: 3 },
  { nome: 'New Holland', tipo: 'ambos', ordem: 4 },
  { nome: 'Case IH', tipo: 'ambos', ordem: 5 },
  { nome: 'Jacto', tipo: 'ambos', ordem: 6 },
  { nome: 'Stara', tipo: 'maquina', ordem: 7 },
  { nome: 'Agrale', tipo: 'ambos', ordem: 8 },
  { nome: 'Ford', tipo: 'maquina', ordem: 9 },
  { nome: 'Bosch', tipo: 'peca', ordem: 10 },
  { nome: 'MWM', tipo: 'peca', ordem: 11 },
  { nome: 'Perkins', tipo: 'peca', ordem: 12 },
  { nome: 'Outra', tipo: 'ambos', ordem: 99 },
];

/* ── serviços ──────────────────────────────────────────────────
   O que o prestador marca em "Meus serviços". Fechado, e não texto livre:
   "retífica de cabeçote" e "retificar cabecote" seriam dois serviços
   diferentes num campo aberto, e nenhum apareceria na busca do outro. */
const SERVICOS = [
  { categoria: 'Mecânica', itens: ['Retífica de motor', 'Retífica de cabeçote', 'Reparo de transmissão', 'Troca de embreagem', 'Revisão preventiva', 'Diagnóstico eletrônico com scanner'] },
  { categoria: 'Hidráulica', itens: ['Reparo de bomba hidráulica', 'Reparo de cilindro', 'Troca de mangueiras', 'Montagem de kit hidráulico'] },
  { categoria: 'Elétrica', itens: ['Sistema elétrico 12V/24V', 'Alternador e motor de partida', 'Chicote e painel', 'Instalação de piloto automático'] },
  { categoria: 'Solda e usinagem', itens: ['Solda de chassi', 'Recuperação de peça', 'Usinagem de pinos e buchas', 'Torno e fresa'] },
  { categoria: 'Pulverização e plantio', itens: ['Regulagem de bicos', 'Manutenção de pulverizador', 'Regulagem de plantadeira', 'Aferição de vazão'] },
];

module.exports = {
  async up() {
    /* ── categorias ─────────────────────────────────────────── */
    const mapaCategorias = new Map();

    for (const [indice, definicao] of CATEGORIAS.entries()) {
      const slug = `${slugificar(definicao.nome)}-${definicao.tipo}`;

      const [categoria] = await db.Categoria.findOrCreate({
        where: { slug },
        defaults: {
          nome: definicao.nome,
          nome_normalizado: normalizar(definicao.nome),
          slug,
          tipo: definicao.tipo,
          icone: definicao.icone || null,
          destaque: Boolean(definicao.destaque),
          ordem: indice + 1,
          ativo: true,
        },
      });

      mapaCategorias.set(`${definicao.nome}|${definicao.tipo}`, categoria);

      for (const [posicao, nomeFilha] of (definicao.filhas || []).entries()) {
        const slugFilha = `${slug}-${slugificar(nomeFilha)}`;

        await db.Categoria.findOrCreate({
          where: { slug: slugFilha },
          defaults: {
            parent_id: categoria.id,
            nome: nomeFilha,
            nome_normalizado: normalizar(nomeFilha),
            slug: slugFilha,
            tipo: definicao.tipo,
            ordem: posicao + 1,
            ativo: true,
          },
        });
      }
    }

    /* ── marcas ─────────────────────────────────────────────── */
    for (const marca of MARCAS) {
      await db.Marca.findOrCreate({
        where: { slug: slugificar(marca.nome) },
        defaults: {
          nome: marca.nome,
          nome_normalizado: normalizar(marca.nome),
          slug: slugificar(marca.nome),
          tipo: marca.tipo,
          ordem: marca.ordem,
          ativo: true,
        },
      });
    }

    /* ── serviços ───────────────────────────────────────────── */
    for (const grupo of SERVICOS) {
      const categoria = mapaCategorias.get(`${grupo.categoria}|servico`);

      for (const [posicao, nome] of grupo.itens.entries()) {
        await db.Servico.findOrCreate({
          where: { slug: slugificar(nome) },
          defaults: {
            categoria_id: categoria ? categoria.id : null,
            nome,
            nome_normalizado: normalizar(nome),
            slug: slugificar(nome),
            ordem: posicao + 1,
            ativo: true,
          },
        });
      }
    }

    const totais = {
      categorias: await db.Categoria.count(),
      marcas: await db.Marca.count(),
      servicos: await db.Servico.count(),
    };

    console.log('[seed] vocabulário do produto:', totais);
  },

  /**
   * O `down` apaga só o que este seeder cria, pelo slug.
   *
   * Um `truncate` levaria junto o que a administração cadastrou depois — e
   * seeder que destrói dado de produção é a forma mais rápida de perder o
   * trabalho de alguém.
   */
  async down() {
    const slugsCategoria = [];

    CATEGORIAS.forEach((definicao) => {
      const base = `${slugificar(definicao.nome)}-${definicao.tipo}`;
      slugsCategoria.push(base);
      (definicao.filhas || []).forEach((filha) =>
        slugsCategoria.push(`${base}-${slugificar(filha)}`)
      );
    });

    await db.Servico.destroy({
      where: { slug: SERVICOS.flatMap((grupo) => grupo.itens.map(slugificar)) },
      force: true,
    });

    await db.Categoria.destroy({ where: { slug: slugsCategoria }, force: true });
    await db.Marca.destroy({ where: { slug: MARCAS.map((marca) => slugificar(marca.nome)) }, force: true });
  },
};
