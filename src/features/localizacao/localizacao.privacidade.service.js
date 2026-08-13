'use strict';

const { ofuscarCoordenada, coordenadaValida } = require('../../utils/geo');
const { RAIO_OFUSCACAO_METROS } = require('./localizacao.constants');
const { pode } = require('../../rbac');

/**
 * Privacidade da localização — regra da cliente e obrigação de LGPD.
 *
 * Maturacao/05 §9.3: o produtor rural anuncia da própria propriedade, e
 * publicar o endereço exato dele é publicar onde ele dorme. O model já nasce
 * com `Perfil.exibir_endereco_exato = false`; este service é quem faz esse
 * campo VALER na resposta da API.
 *
 * Regra em uma frase: **o endereço completo e a coordenada exata só saem da API
 * quando o titular consentiu, ou para quem é o próprio titular (ou o Admin).**
 * Fora disso, sai município, bairro e uma coordenada deslocada.
 *
 * O ponto delicado é que ofuscar na CAMADA DE RESPOSTA não basta se a
 * coordenada exata também for exposta por outra rota — por isso a decisão está
 * num service, chamado por todo mapper que devolve endereço, e não escondida
 * dentro de um `if` no controller.
 */

/**
 * Quem vê o endereço exato.
 *
 * @param contexto     contexto da requisição (visitante inclusive)
 * @param opcoes.donoId              usuário titular do endereço
 * @param opcoes.exibirEnderecoExato consentimento do titular
 * @param opcoes.acaoLer             ação RBAC do alvo ('perfil.ler' / 'anuncio.ler')
 */
function podeVerExato(contexto, { donoId, exibirEnderecoExato, acaoLer = 'perfil.ler' } = {}) {
  /* o titular sempre vê o próprio endereço: esconder dele o que ele cadastrou
     transformaria a tela de edição num formulário que apaga dado */
  if (contexto?.usuarioId && donoId && String(contexto.usuarioId) === String(donoId)) return true;

  /* escopo `todos` (Admin/moderador) enxerga — é o poder de intervenção que a
     cliente pediu. Toda leitura assim gera log de acesso a dado pessoal, feito
     por quem chama (ver localizacao.endereco.service) */
  if (pode(contexto, acaoLer, { donoId: null }) && contexto?.admin) return true;

  return Boolean(exibirEnderecoExato);
}

/**
 * Aplica a privacidade sobre um endereço.
 *
 * Devolve SEMPRE o mesmo formato — com ou sem permissão. Formatos diferentes
 * conforme o espectador entregam a informação pela própria forma da resposta:
 * um campo ausente já diz "aqui existe algo escondido", e a diferença de
 * tamanho da resposta é observável.
 *
 * @returns objeto simples pronto para o mapper
 */
function aplicar(endereco, { exato = false } = {}) {
  if (!endereco) return null;

  const temCoordenada = coordenadaValida(endereco.latitude, endereco.longitude);

  if (exato) {
    return {
      id: endereco.id,
      cep: endereco.cep,
      logradouro: endereco.logradouro,
      numero: endereco.numero,
      complemento: endereco.complemento,
      bairro: endereco.bairro,
      referencia: endereco.referencia,
      municipioId: endereco.municipio_id,
      municipio: endereco.municipio_nome,
      uf: endereco.uf,
      latitude: temCoordenada ? Number(endereco.latitude) : null,
      longitude: temCoordenada ? Number(endereco.longitude) : null,
      precisao: endereco.precisao,
      origem: endereco.origem,
      aproximado: false,
    };
  }

  /* deslocamento determinístico, semeado pelo id do endereço: pedir o mesmo
     anúncio mil vezes devolve sempre o MESMO ponto falso. Com jitter aleatório
     por requisição, a média de mil leituras convergiria para o ponto real e a
     proteção seria puramente decorativa */
  const disfarcada = temCoordenada
    ? ofuscarCoordenada(endereco.latitude, endereco.longitude, {
        raioMetros: RAIO_OFUSCACAO_METROS,
        semente: endereco.id || `${endereco.municipio_id}`,
      })
    : null;

  return {
    id: endereco.id,
    /* CEP identifica a rua; logradouro e número identificam a casa. Nada disso
       sai sem consentimento — o que sobra é o suficiente para o comprador
       decidir se vale a viagem */
    cep: null,
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: endereco.bairro,
    referencia: null,
    municipioId: endereco.municipio_id,
    municipio: endereco.municipio_nome,
    uf: endereco.uf,
    latitude: disfarcada ? disfarcada.latitude : null,
    longitude: disfarcada ? disfarcada.longitude : null,
    precisao: 'aproximada',
    origem: endereco.origem,
    /* o front usa isto para o selo "Localização aproximada" (§9.2) */
    aproximado: true,
    raioAproximacaoMetros: RAIO_OFUSCACAO_METROS,
  };
}

/**
 * Distância que pode ser divulgada.
 *
 * Divulgar "12,847 km" a partir de um ponto ofuscado é um convite à
 * trilateração: três consultas de origens diferentes recuperam o centro real
 * mesmo com o pino deslocado. Por isso, quando a localização é aproximada, a
 * distância sai arredondada para a faixa de 5 km.
 */
function distanciaDivulgavel(distanciaKm, { exato = false } = {}) {
  if (distanciaKm === null || distanciaKm === undefined) return null;
  if (exato) return distanciaKm;
  return Math.max(5, Math.round(distanciaKm / 5) * 5);
}

module.exports = { podeVerExato, aplicar, distanciaDivulgavel };
