'use strict';

const db = require('../../models');
const { BLOCO_EXPORTACAO } = require('./lgpd.constants');

/**
 * Montagem do pacote de dados do titular. Chamado só pelo job — nunca no
 * caminho da resposta.
 *
 * Duas exigências moldam este arquivo:
 *
 * 1. **Legível por gente** (art. 9º: informação clara e adequada). As chaves
 *    saem em português e sem os nomes internos das colunas; um arquivo que só
 *    um desenvolvedor entende não cumpre o direito de acesso.
 * 2. **Em blocos.** `findAll` sem limite numa conta de lojista antigo carrega
 *    milhares de mensagens de uma vez; o worker morre por memória justamente
 *    nas contas onde o export mais importa.
 *
 * O que NÃO entra: `senha_hash`, `ip_hash`, `observacoes_internas`. Hash de
 * senha é dado sobre o titular, mas devolvê-lo num arquivo que trafega por
 * e-mail cria um risco que o direito de acesso não pede — e o titular não tem
 * o que fazer com ele.
 */

/** percorre uma tabela em páginas e devolve tudo já mapeado */
async function emBlocos(model, opcoes, mapear) {
  const itens = [];
  let offset = 0;

  for (;;) {
    const pagina = await model.findAll({
      ...opcoes,
      order: opcoes.order || [['criado_em', 'ASC']],
      offset,
      limit: BLOCO_EXPORTACAO,
    });

    pagina.forEach((linha) => itens.push(mapear(linha)));
    if (pagina.length < BLOCO_EXPORTACAO) break;
    offset += BLOCO_EXPORTACAO;
  }

  return itens;
}

async function conta(usuarioId) {
  const usuario = await db.Usuario.findByPk(usuarioId, {
    attributes: [
      'id', 'nome', 'email', 'telefone', 'whatsapp', 'status', 'idioma', 'fuso_horario',
      'email_verificado_em', 'ultimo_login_em', 'total_logins', 'anonimizado_em', 'criado_em',
    ],
  });
  if (!usuario) return null;

  return {
    identificador: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    telefone: usuario.telefone,
    whatsapp: usuario.whatsapp,
    situacaoDaConta: usuario.status,
    idioma: usuario.idioma,
    fusoHorario: usuario.fuso_horario,
    emailConfirmadoEm: usuario.email_verificado_em,
    ultimoAcessoEm: usuario.ultimo_login_em,
    totalDeAcessos: usuario.total_logins,
    anonimizadaEm: usuario.anonimizado_em,
    cadastradaEm: usuario.criado_em,
  };
}

async function perfil(usuarioId) {
  const registro = await db.Perfil.findOne({
    where: { usuario_id: usuarioId },
    include: [{ model: db.Endereco, as: 'endereco', required: false }],
  });
  if (!registro) return null;

  const endereco = registro.endereco;

  return {
    tipo: registro.tipo,
    nomeExibicao: registro.nome_exibicao,
    apelidoNaUrl: registro.slug,
    pessoa: registro.pessoa_tipo,
    documento: registro.documento,
    tipoDeDocumento: registro.documento_tipo,
    razaoSocial: registro.razao_social,
    nomeFantasia: registro.nome_fantasia,
    inscricaoEstadual: registro.inscricao_estadual,
    descricao: registro.bio,
    site: registro.site,
    instagram: registro.instagram,
    facebook: registro.facebook,
    whatsapp: registro.whatsapp,
    telefoneSecundario: registro.telefone_secundario,
    emailPublico: registro.email_publico,
    exibeWhatsapp: registro.exibir_whatsapp,
    aceitaChat: registro.aceita_chat,
    propriedade: registro.propriedade_nome,
    areaHectares: registro.area_hectares,
    endereco: endereco
      ? {
          cep: endereco.cep,
          logradouro: endereco.logradouro,
          numero: endereco.numero,
          complemento: endereco.complemento,
          bairro: endereco.bairro,
          municipio: endereco.municipio_nome,
          uf: endereco.uf,
          latitude: endereco.latitude,
          longitude: endereco.longitude,
        }
      : null,
    criadoEm: registro.criado_em,
  };
}

const anuncios = (usuarioId) =>
  emBlocos(
    db.Anuncio,
    {
      where: { usuario_id: usuarioId },
      attributes: ['id', 'titulo', 'descricao', 'status', 'preco_centavos', 'criado_em', 'publicado_em'],
      paranoid: false,
    },
    (linha) => ({
      identificador: linha.id,
      titulo: linha.titulo,
      descricao: linha.descricao,
      situacao: linha.status,
      precoEmReais: linha.preco_centavos === null ? null : linha.preco_centavos / 100,
      criadoEm: linha.criado_em,
      publicadoEm: linha.publicado_em,
    })
  );

/**
 * Mensagens ENVIADAS pelo titular.
 *
 * O que o outro lado escreveu não entra: é dado pessoal de terceiro, e o
 * direito de acesso do art. 18 é sobre os dados DO titular. Entregar a
 * conversa inteira transformaria o export num jeito legítimo de baixar o que
 * outra pessoa escreveu em particular.
 */
const mensagens = (usuarioId) =>
  emBlocos(
    db.Mensagem,
    {
      where: { remetente_id: usuarioId },
      attributes: ['id', 'conversa_id', 'tipo', 'conteudo', 'criado_em', 'removida_em'],
      paranoid: false,
    },
    (linha) => ({
      identificador: linha.id,
      conversa: linha.conversa_id,
      tipo: linha.tipo,
      conteudo: linha.removida_em ? '[mensagem removida]' : linha.conteudo,
      enviadaEm: linha.criado_em,
    })
  );

const favoritos = (usuarioId) =>
  emBlocos(
    db.Favorito,
    { where: { usuario_id: usuarioId }, attributes: ['anuncio_id', 'anotacao', 'criado_em'] },
    (linha) => ({ anuncio: linha.anuncio_id, anotacao: linha.anotacao, salvoEm: linha.criado_em })
  );

const consentimentos = (usuarioId) =>
  emBlocos(
    db.Consentimento,
    {
      where: { usuario_id: usuarioId },
      attributes: ['tipo', 'aceito', 'versao_documento', 'base_legal', 'finalidade', 'origem', 'revogado_em', 'criado_em'],
    },
    (linha) => ({
      assunto: linha.tipo,
      aceito: linha.aceito,
      versaoDoDocumento: linha.versao_documento,
      baseLegal: linha.base_legal,
      finalidade: linha.finalidade,
      coletadoEm: linha.origem,
      revogadoEm: linha.revogado_em,
      registradoEm: linha.criado_em,
    })
  );

const solicitacoes = (usuarioId) =>
  emBlocos(
    db.SolicitacaoTitular,
    { where: { usuario_id: usuarioId }, attributes: ['id', 'tipo', 'status', 'prazo_em', 'respondida_em', 'resposta', 'criado_em'] },
    (linha) => ({
      protocolo: linha.id,
      tipo: linha.tipo,
      situacao: linha.status,
      prazoEm: linha.prazo_em,
      respondidaEm: linha.respondida_em,
      resposta: linha.resposta,
      abertaEm: linha.criado_em,
    })
  );

/** quem da plataforma abriu dados deste titular — prestação de contas */
const acessosAosMeusDados = (usuarioId) =>
  emBlocos(
    db.LogAcessoDado,
    { where: { titular_id: usuarioId }, attributes: ['recurso', 'motivo', 'criado_em'] },
    (linha) => ({ oQueFoiAberto: linha.recurso, motivo: linha.motivo, em: linha.criado_em })
  );

/** o pacote completo, na ordem em que uma pessoa leria */
async function montar(usuarioId) {
  const dadosDaConta = await conta(usuarioId);
  if (!dadosDaConta) return null;

  const [meuPerfil, meusAnuncios, minhasMensagens, meusFavoritos, meusConsentimentos, minhasSolicitacoes, acessos] =
    await Promise.all([
      perfil(usuarioId),
      anuncios(usuarioId),
      mensagens(usuarioId),
      favoritos(usuarioId),
      consentimentos(usuarioId),
      solicitacoes(usuarioId),
      acessosAosMeusDados(usuarioId),
    ]);

  return {
    sobreEsteArquivo: {
      descricao:
        'Cópia dos dados pessoais mantidos pela AgroPeças MT sobre você, ' +
        'em atendimento ao art. 18 da Lei 13.709/2018 (LGPD).',
      geradoEm: new Date().toISOString(),
      formato: 'JSON (UTF-8)',
      observacao:
        'Mensagens escritas por outras pessoas não constam: são dados pessoais delas. ' +
        'Senhas não constam em nenhuma forma.',
      encarregado: require('../../config').lgpd.encarregadoEmail,
    },
    conta: dadosDaConta,
    perfil: meuPerfil,
    anuncios: meusAnuncios,
    mensagensQueEnviei: minhasMensagens,
    favoritos: meusFavoritos,
    consentimentos: meusConsentimentos,
    solicitacoesDePrivacidade: minhasSolicitacoes,
    quemAbriuMeusDados: acessos,
  };
}

module.exports = { montar, emBlocos };
