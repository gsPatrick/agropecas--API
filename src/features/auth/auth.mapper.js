'use strict';

const { mascararEmail, mascararTelefone } = require('../../utils/texto');

/**
 * Model → JSON da API.
 *
 * Existe para que nenhum service devolva instância do Sequelize direto: fazer
 * isso publica o schema inteiro (senha_hash, observacoes_internas, ip_hash) na
 * primeira rota que alguém escrever com pressa. Aqui a exposição é lista
 * branca — campo novo no banco não aparece na API sem alguém decidir.
 */

const usuario = (registro) => {
  if (!registro) return null;
  return {
    id: registro.id,
    nome: registro.nome,
    email: registro.email,
    telefone: registro.telefone,
    whatsapp: registro.whatsapp,
    status: registro.status,
    emailVerificado: Boolean(registro.email_verificado_em),
    emailVerificadoEm: registro.email_verificado_em,
    ultimoLoginEm: registro.ultimo_login_em,
    criadoEm: registro.criado_em,
  };
};

/**
 * Município no formato `{id, nome, uf}` — não só o id.
 *
 * Sem o nome, o front que mostra "Sorriso · MT" no cabeçalho do painel
 * precisaria de uma segunda chamada só para traduzir o uuid, e a maioria das
 * telas simplesmente deixava a cidade em branco. `include` é opcional porque
 * nem toda consulta de perfil carrega a associação — sem essa guarda, pedir
 * `.nome` de `undefined` derrubaria a resposta inteira por causa de um campo
 * decorativo.
 */
const municipioDoPerfil = (registro) =>
  registro.municipio ? { id: registro.municipio.id, nome: registro.municipio.nome, uf: registro.municipio.uf } : null;

const perfil = (registro) => {
  if (!registro) return null;
  return {
    id: registro.id,
    tipo: registro.tipo,
    slug: registro.slug,
    nomeExibicao: registro.nome_exibicao,
    fotoUrl: registro.foto_url,
    whatsapp: registro.exibir_whatsapp ? registro.whatsapp : null,
    exibirWhatsapp: registro.exibir_whatsapp,
    aceitaChat: registro.aceita_chat,
    verificado: Boolean(registro.verificado_em),
    municipioId: registro.municipio_id,
    municipio: municipioDoPerfil(registro),
    uf: registro.uf,
  };
};

/** o que o front recebe logo após entrar/cadastrar */
const sessaoCompleta = ({ usuario: registro, perfil: perfilRegistro, tokens, papeis, permissoes }) => ({
  usuario: usuario(registro),
  perfil: perfil(perfilRegistro),
  papeis: papeis || [],
  /* o front usa isto só para esconder botão — a decisão real é do servidor */
  permissoes: permissoes || [],
  tokens,
});

const sessao = (registro, { atual } = {}) => ({
  id: registro.id,
  dispositivo: registro.dispositivo,
  plataforma: registro.plataforma,
  ultimaAtividadeEm: registro.ultima_atividade_em,
  expiraEm: registro.expira_em,
  criadoEm: registro.criado_em,
  atual: registro.id === atual,
});

const consentimento = (registro) => ({
  id: registro.id,
  tipo: registro.tipo,
  aceito: registro.aceito,
  versaoDocumento: registro.versao_documento,
  baseLegal: registro.base_legal,
  revogadoEm: registro.revogado_em,
  criadoEm: registro.criado_em,
});

/** dados de contato mascarados para telas de confirmação ("enviamos para j***@...") */
const contatoMascarado = (registro) => ({
  email: mascararEmail(registro.email),
  telefone: registro.telefone ? mascararTelefone(registro.telefone) : null,
});

module.exports = { usuario, perfil, sessaoCompleta, sessao, consentimento, contatoMascarado };
