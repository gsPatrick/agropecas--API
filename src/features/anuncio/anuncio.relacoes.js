'use strict';

const db = require('../../models');

/**
 * Os `include` das consultas de anúncio, num lugar só.
 *
 * Não é enfeite de organização: são estas listas que garantem a promessa de
 * UMA consulta por listagem. Espalhadas por service, o próximo endpoint
 * copiaria a versão errada — ou pior, buscaria a relação num laço, e o N+1
 * voltaria pela porta dos fundos.
 *
 * São FUNÇÕES e não constantes porque o Sequelize consome (e às vezes muta) o
 * objeto de include; compartilhar a mesma instância entre duas consultas
 * simultâneas é bug difícil de achar.
 */

/** relações da LISTAGEM — capa apenas, ficha técnica não entra no cartão */
const INCLUDES_LISTA = () => [
  { model: db.Categoria, as: 'categoria', attributes: ['id', 'nome', 'slug', 'icone'] },
  { model: db.Marca, as: 'marca', attributes: ['id', 'nome', 'slug'] },
  /* latitude/longitude entram aqui porque a sede do município é o pino do mapa
     quando o anunciante não autorizou o endereço exato — sem elas, o front
     precisaria de uma segunda chamada por cartão (N+1 do lado do navegador) ou
     de uma tabela de coordenadas duplicada no código, que foi o que existia */
  { model: db.Municipio, as: 'municipio', attributes: ['id', 'nome', 'uf', 'latitude', 'longitude'] },
  {
    model: db.Perfil,
    as: 'perfil',
    attributes: [
      'id', 'slug', 'nome_exibicao', 'tipo', 'foto_url', 'verificado_em',
      'exibir_whatsapp', 'whatsapp', 'exibir_endereco_exato', 'aceita_chat',
      'total_anuncios_ativos', 'membro_desde',
    ],
  },
  {
    model: db.AnuncioFoto,
    as: 'fotos',
    /* só a capa: a galeria inteira multiplicaria as linhas do JOIN por foto */
    where: { principal: true, bloqueada: false },
    required: false,
    attributes: ['id', 'url', 'url_thumb', 'ordem', 'principal', 'texto_alternativo', 'bloqueada'],
  },
];

const INCLUDES_DETALHE = () => [
  ...INCLUDES_LISTA().filter((item) => item.as !== 'fotos'),
  {
    model: db.AnuncioFoto,
    as: 'fotos',
    required: false,
    attributes: ['id', 'url', 'url_thumb', 'largura', 'altura', 'ordem', 'principal', 'texto_alternativo', 'bloqueada'],
  },
  { model: db.AnuncioAtributo, as: 'atributos' },
  {
    model: db.Maquina,
    as: 'maquinasCompativeis',
    attributes: ['id', 'modelo', 'slug', 'categoria_maquina'],
    through: { attributes: [] },
  },
];

module.exports = { INCLUDES_LISTA, INCLUDES_DETALHE };
