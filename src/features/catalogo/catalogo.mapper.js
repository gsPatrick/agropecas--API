'use strict';

/**
 * Model → JSON da API.
 *
 * Lista branca, como manda o padrão §6. No catálogo o risco não é vazar senha —
 * é vazar o que ainda não deveria ser público: `total_anuncios` é contador
 * mantido por job e sai porque a landing mostra "Peças mais procuradas", mas
 * `removido_em` e `atualizado_em` não têm por que virar contrato de API só
 * porque existem na tabela.
 *
 * O catálogo é servido do cache, e cache guarda objeto simples. Mapear antes
 * de gravar é o que garante isso: instância do Sequelize serializada e
 * ressuscitada do Redis vira um objeto meio-vivo, sem métodos e com `dataValues`
 * aninhado, que quebra longe da causa.
 */

const categoria = (registro) => {
  if (!registro) return null;
  return {
    id: registro.id,
    parentId: registro.parent_id,
    nome: registro.nome,
    slug: registro.slug,
    descricao: registro.descricao,
    tipo: registro.tipo,
    icone: registro.icone,
    imagemUrl: registro.imagem_url,
    ordem: registro.ordem,
    destaque: registro.destaque,
    ativo: registro.ativo,
    totalAnuncios: registro.total_anuncios,
  };
};

const marca = (registro) => {
  if (!registro) return null;
  return {
    id: registro.id,
    nome: registro.nome,
    slug: registro.slug,
    logoUrl: registro.logo_url,
    tipo: registro.tipo,
    ordem: registro.ordem,
    ativo: registro.ativo,
  };
};

const maquina = (registro) => {
  if (!registro) return null;
  return {
    id: registro.id,
    marcaId: registro.marca_id,
    /* o front mostra "John Deere 6110J" num item só; sem o nome da marca aqui
       ele teria de cruzar duas listas para desenhar um select */
    marca: registro['marca.nome']
      ? { id: registro.marca_id, nome: registro['marca.nome'], slug: registro['marca.slug'] }
      : marca(registro.marca),
    modelo: registro.modelo,
    slug: registro.slug,
    categoriaMaquina: registro.categoria_maquina,
    anoInicio: registro.ano_inicio,
    anoFim: registro.ano_fim,
    potenciaCv: registro.potencia_cv,
    observacao: registro.observacao,
    ativo: registro.ativo,
  };
};

const servico = (registro) => {
  if (!registro) return null;
  return {
    id: registro.id,
    categoriaId: registro.categoria_id,
    categoria: registro['categoria.nome']
      ? { id: registro.categoria_id, nome: registro['categoria.nome'], slug: registro['categoria.slug'] }
      : categoria(registro.categoria),
    nome: registro.nome,
    slug: registro.slug,
    descricao: registro.descricao,
    icone: registro.icone,
    ordem: registro.ordem,
    ativo: registro.ativo,
    totalPrestadores: registro.total_prestadores,
  };
};

/** cultura no CATÁLOGO (produtor) — diferente de `perfil.mapper.js:cultura`,
    que traz `principal` da tabela de ligação; aqui é só o item do vocabulário */
const culturaCatalogo = (registro) => ({
  id: registro.id,
  nome: registro.nome,
  slug: registro.slug,
  icone: registro.icone,
  grupo: registro.grupo,
});

module.exports = { categoria, marca, maquina, servico, culturaCatalogo };
