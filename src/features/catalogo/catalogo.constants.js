'use strict';

/**
 * Vocabulários fechados do catálogo.
 *
 * Os enums estruturais do domínio vivem em `src/models/constantes.js`; estes
 * aqui são específicos do módulo e não têm por que poluir aquele arquivo.
 */

/** tipos de categoria — o mesmo enum da coluna `categorias.tipo` */
const CATEGORIA_TIPO = ['peca', 'servico', 'ambos'];

/** tipos de marca — fabricante de máquina, de peça, ou os dois */
const MARCA_TIPO = ['maquina', 'peca', 'ambos'];

/** famílias de maquinário — o mesmo enum de `maquinas.categoria_maquina` */
const MAQUINA_CATEGORIA = [
  'trator',
  'colheitadeira',
  'pulverizador',
  'plantadeira',
  'implemento',
  'caminhao',
  'motor',
  'outro',
];

/**
 * TTL do catálogo em segundos.
 *
 * Uma hora não é chute: categoria, marca e serviço mudam quando o Admin abre a
 * tela de gestão — semanas entre uma alteração e outra — mas são lidos em
 * TODA tela do produto (select do formulário de anúncio, filtro da busca,
 * landing). Manter isso a um SELECT por requisição é gastar banco à toa.
 *
 * O TTL é rede de segurança, não estratégia: toda escrita invalida
 * explicitamente (ver `catalogo.cache.js`). Se um dia o cache for perdido em
 * outra instância sem passar pela invalidação, uma hora é o pior atraso
 * possível para o Admin ver a mudança.
 */
const TTL_CATALOGO = 60 * 60;

/** entidades do catálogo, como aparecem em `logs_auditoria.entidade` */
const ENTIDADE = {
  CATEGORIA: 'categorias',
  MARCA: 'marcas',
  MAQUINA: 'maquinas',
  SERVICO: 'servicos',
};

module.exports = {
  CATEGORIA_TIPO,
  MARCA_TIPO,
  MAQUINA_CATEGORIA,
  TTL_CATALOGO,
  ENTIDADE,
};
