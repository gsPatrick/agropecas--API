'use strict';

const { campos, esquema } = require('../../validacao');
const { ENDERECO_ORIGEM } = require('../../models/constantes');
const { ALVO, RAIO_BUSCA_MAX_KM, RAIO_BUSCA_PADRAO_KM, MAX_ALVOS_DISTANCIA } = require('./localizacao.constants');

/**
 * Esquemas de entrada da feature.
 *
 * Nenhuma biblioteca de validação aparece aqui — só o vocabulário de
 * `src/validacao`. Compilados uma vez, no carregamento do módulo.
 */

const latitude = () =>
  campos.numero().min(-90, 'Latitude fora da faixa válida.').max(90, 'Latitude fora da faixa válida.');

const longitude = () =>
  campos
    .numero()
    .min(-180, 'Longitude fora da faixa válida.')
    .max(180, 'Longitude fora da faixa válida.');

const consultarCep = esquema({
  cep: campos.cep().obrigatorio('Informe o CEP.').rotulo('CEP'),
});

const reverso = esquema({
  latitude: latitude().obrigatorio('Informe a latitude.'),
  longitude: longitude().obrigatorio('Informe a longitude.'),
});

const listarMunicipios = esquema({
  /* MT é o foco do produto, mas a UF continua sendo parâmetro: quem mora em
     Rondonópolis compra em Goiás, e travar em 'MT' no código tiraria isso do
     alcance sem ninguém decidir */
  uf: campos.texto().min(2).max(2).rotulo('UF'),
  busca: campos.texto().max(120),
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1),
});

/**
 * Endereço para gravação.
 *
 * `alvo` + `alvoId` no corpo e não na rota porque o mesmo endpoint serve perfil
 * e anúncio; quem manda o dono é o RBAC, não este esquema. Nenhum `usuario_id`
 * é aceito daqui — ele sai do contexto autenticado (PADRAO_MODULO §11.2).
 */
const salvarEndereco = esquema({
  alvo: campos.umDe(Object.values(ALVO)).obrigatorio('Informe a que este endereço pertence.'),
  alvoId: campos.uuid().obrigatorio('Identificador inválido.'),

  origem: campos.umDe(ENDERECO_ORIGEM).obrigatorio('Informe como o endereço foi obtido.'),

  cep: campos.cep(),
  logradouro: campos.texto().max(200),
  numero: campos.texto().max(20),
  complemento: campos.texto().max(120),
  bairro: campos.texto().max(120),
  referencia: campos.texto().max(200),

  municipioId: campos.uuid(),
  /* quem veio do ViaCEP tem o nome, não o id — o service resolve para o id da
     nossa tabela; aceitar só `municipioId` obrigaria o front a fazer isso */
  municipioNome: campos.texto().max(120),
  uf: campos.texto().min(2).max(2),

  latitude: latitude(),
  longitude: longitude(),

  /* consentimento LGPD do titular sobre a própria localização: quem manda é o
     dono do perfil, e o valor espelha `perfis.exibir_endereco_exato` */
  exibirEnderecoExato: campos.booleano(),
});

const identificador = esquema({ id: campos.uuid().obrigatorio('Identificador inválido.') });

/** distância de um ponto até anúncios ou perfis */
const distancia = esquema({
  latitude: latitude().obrigatorio('Informe a latitude de origem.'),
  longitude: longitude().obrigatorio('Informe a longitude de origem.'),
  alvo: campos.umDe(Object.values(ALVO)).obrigatorio('Informe o tipo de alvo.'),
  ids: campos
    .lista(campos.uuid())
    .obrigatorio('Informe ao menos um item.')
    .min(1, 'Informe ao menos um item.')
    .max(MAX_ALVOS_DISTANCIA, `No máximo ${MAX_ALVOS_DISTANCIA} itens por consulta.`),
});

/** filtro de proximidade reaproveitável por busca de anúncio */
const proximidade = esquema({
  latitude: latitude().obrigatorio('Informe a latitude.'),
  longitude: longitude().obrigatorio('Informe a longitude.'),
  raioKm: campos
    .numero()
    .min(1)
    .max(RAIO_BUSCA_MAX_KM, `O raio máximo é de ${RAIO_BUSCA_MAX_KM} km.`)
    .padrao(RAIO_BUSCA_PADRAO_KM),
});

module.exports = {
  consultarCep,
  reverso,
  listarMunicipios,
  salvarEndereco,
  identificador,
  distancia,
  proximidade,
};
