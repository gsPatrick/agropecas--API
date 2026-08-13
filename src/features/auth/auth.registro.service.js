'use strict';

const db = require('../../models');
const senhaProvider = require('../../providers/senha');
const { erros } = require('../../utils/erros');
const { normalizarEmail, paraE164, slugify, somenteDigitos, capitalizarNome } = require('../../utils/texto');
const { tipoDocumento } = require('../../utils/documento');
const consentimentoService = require('./auth.consentimento.service');
const sessaoService = require('./auth.sessao.service');
const verificacaoService = require('./auth.verificacao.service');
const auditoria = require('../auditoria/auditoria.service');
const enderecoService = require('../perfil/perfil.endereco.service');
const { CONSENTIMENTOS_OBRIGATORIOS } = require('./auth.constants');

/**
 * Criação de conta. O cadastro nasce com três coisas ao mesmo tempo —
 * Usuário, Perfil e papel `usuario` — e as três precisam existir ou nenhuma:
 * um usuário sem perfil não consegue anunciar nem aparecer na plataforma.
 * Por isso tudo roda em UMA transação.
 *
 * As três variações de perfil (produtor, loja, prestador) compartilham este
 * caminho: o que muda entre elas são campos, não fluxo. Ver Maturacao/05 §2.
 */

/** slug único e legível para a página pública do perfil */
async function slugDisponivel(nome, transacao) {
  const base = slugify(nome).slice(0, 140) || 'perfil';
  let candidato = base;
  let contador = 1;

  /* colisão de nome é comum ("Auto Peças MT"): sufixo numérico em vez de hash
     mantém a URL apresentável */
  while (await db.Perfil.findOne({ where: { slug: candidato }, transaction: transacao })) {
    contador += 1;
    candidato = `${base}-${contador}`;
  }
  return candidato;
}

/** garante que os aceites obrigatórios vieram marcados */
function conferirConsentimentos(consentimentos = []) {
  const aceitos = consentimentos.filter((item) => item.aceito !== false).map((item) => item.tipo);
  const faltando = CONSENTIMENTOS_OBRIGATORIOS.filter((tipo) => !aceitos.includes(tipo));

  if (faltando.length) {
    throw erros.validacao({
      consentimentos: 'É preciso aceitar os Termos de Uso e a Política de Privacidade.',
    });
  }
}

/** monta o Perfil conforme o tipo — campos de um tipo não vazam para outro */
function montarPerfil(dados, { usuarioId, slug }) {
  const documento = dados.documento ? somenteDigitos(dados.documento) : null;

  const base = {
    usuario_id: usuarioId,
    tipo: dados.tipoPerfil,
    slug,
    nome_exibicao: dados.nomeExibicao || capitalizarNome(dados.nome),
    pessoa_tipo: documento && documento.length === 14 ? 'juridica' : 'fisica',
    documento_tipo: documento ? tipoDocumento(documento) : null,
    documento,
    whatsapp: dados.whatsapp ? paraE164(dados.whatsapp) : null,
    exibir_whatsapp: dados.exibirWhatsapp !== false,
    membro_desde: new Date(),
    ultima_atividade_em: new Date(),
  };

  if (dados.tipoPerfil === 'produtor') {
    return { ...base, propriedade_nome: dados.propriedadeNome || null, area_hectares: dados.areaHectares || null };
  }

  if (dados.tipoPerfil === 'loja') {
    return {
      ...base,
      razao_social: dados.razaoSocial || null,
      nome_fantasia: dados.nomeFantasia || dados.nomeExibicao || null,
      inscricao_estadual: dados.inscricaoEstadual || null,
      entrega_observacao: dados.entregaObservacao || null,
    };
  }

  if (dados.tipoPerfil === 'prestador') {
    return {
      ...base,
      atende_no_campo: dados.atendeNoCampo ?? true,
      raio_atendimento_km: dados.raioAtendimentoKm || null,
    };
  }

  /* `cliente` — quem só compra. Sem campo extra nenhum: o perfil dele é só
     conta, favoritos e conversa. Colunas de vitrine (propriedade, atendimento,
     raio) não fazem sentido para quem não publica, e um branch explícito aqui
     é o que evita herdar por acidente os campos do prestador (era o `else`
     de antes) só porque ele veio por último na lista. */
  return { ...base };
}

async function criar(dados, contexto) {
  const emailNormalizado = normalizarEmail(dados.email);

  conferirConsentimentos(dados.consentimentos);

  const existente = await db.Usuario.findOne({ where: { email_normalizado: emailNormalizado } });
  if (existente) {
    throw erros.conflito('Este e-mail já está cadastrado.', {
      campos: { email: 'Já está em uso.' },
    });
  }

  /* CPF/CNPJ é único por perfil. Conferir antes dá mensagem no campo certo;
     a constraint do banco continua sendo a garantia contra corrida */
  if (dados.documento) {
    const documentoEmUso = await db.Perfil.findOne({
      where: { documento: somenteDigitos(dados.documento) },
    });
    if (documentoEmUso) {
      throw erros.conflito('Este CPF/CNPJ já está cadastrado.', {
        campos: { documento: 'Já está em uso.' },
      });
    }
  }

  const resultado = await db.sequelize.transaction(async (transacao) => {
    const usuario = await db.Usuario.create(
      {
        nome: capitalizarNome(dados.nome),
        email: dados.email.trim(),
        email_normalizado: emailNormalizado,
        senha_hash: await senhaProvider.gerarHash(dados.senha),
        telefone: dados.telefone ? paraE164(dados.telefone) : null,
        whatsapp: dados.whatsapp ? paraE164(dados.whatsapp) : null,
        /* nasce pendente: confirmar o e-mail é o que ativa. Se a plataforma
           decidir não exigir, `AUTH_EXIGIR_EMAIL_VERIFICADO=false` deixa a
           conta usar tudo mesmo pendente — a flexibilidade fica na config */
        status: 'pendente',
        senha_alterada_em: new Date(),
      },
      { transaction: transacao }
    );

    const slug = await slugDisponivel(dados.nomeExibicao || dados.nome, transacao);

    /* o endereço nasce ANTES do perfil, dentro da mesma transação, porque é o
       perfil que aponta para ele. O município é conferido aqui e não confiado:
       um uuid qualquer no corpo deixaria o perfil com localização inventada, e
       a UF sai sempre do município — nunca do cliente */
    const municipio = dados.municipioId
      ? await db.Municipio.findByPk(dados.municipioId, {
          attributes: ['id', 'uf'],
          transaction: transacao,
        })
      : null;

    if (dados.municipioId && !municipio) {
      throw erros.validacao({ municipioId: 'Município não encontrado.' });
    }

    const endereco = await enderecoService.criarParaCadastro(
      dados.endereco,
      municipio ? municipio.id : null,
      { transacao }
    );

    const perfil = await db.Perfil.create(
      {
        ...montarPerfil(dados, { usuarioId: usuario.id, slug }),
        endereco_id: endereco ? endereco.id : null,
        municipio_id: municipio ? municipio.id : null,
        uf: municipio ? municipio.uf : null,
      },
      { transaction: transacao }
    );

    const papel = await db.Papel.findOne({ where: { chave: 'usuario' }, transaction: transacao });
    if (!papel) {
      /* o papel base vem do seed; sem ele a conta nasceria sem permissão
         nenhuma e o cadastro pareceria ter dado certo */
      throw erros.interno('Papel base ausente. Rode `npm run rbac:sync`.');
    }
    await db.UsuarioPapel.create(
      { usuario_id: usuario.id, papel_id: papel.id, concedido_por: null },
      { transaction: transacao }
    );

    await consentimentoService.registrar(usuario.id, dados.consentimentos, contexto, {
      origem: 'cadastro',
      transacao,
    });

    return { usuario, perfil };
  });

  /* fora da transação: e-mail e auditoria não podem segurar (nem desfazer) o
     cadastro se o provedor estiver lento */
  await verificacaoService.enviarCodigo(resultado.usuario, contexto).catch((erro) =>
    console.error('[auth] falha ao enviar verificação', erro.message)
  );

  await auditoria.registrar(contexto, {
    acao: 'criar',
    entidade: 'usuarios',
    entidadeId: resultado.usuario.id,
    depois: { email: emailNormalizado, tipo_perfil: dados.tipoPerfil },
  });

  const { tokens } = await sessaoService.abrir(resultado.usuario, contexto);

  return { ...resultado, tokens };
}

module.exports = { criar, slugDisponivel, montarPerfil };
