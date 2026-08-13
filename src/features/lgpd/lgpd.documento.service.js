'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const cache = require('../../cache');
const auditoria = require('../auditoria/auditoria.service');
const { erros } = require('../../utils/erros');
const { sha256 } = require('../../utils/hash');
const { exigir } = require('../../rbac');
const { chaves, TTL_DOCUMENTO } = require('./lgpd.cache');
const {
  DOCUMENTOS_DE_ACEITE_OBRIGATORIO,
  TIPOS_DOCUMENTO_COM_CONSENTIMENTO,
} = require('./lgpd.constants');

/**
 * Termos de Uso e Política de Privacidade, versionados.
 *
 * A pergunta que este service responde é a que o jurídico faz depois do
 * problema: "a qual texto, exatamente, essa pessoa disse sim?". Sem versão e
 * sem hash do conteúdo, a resposta honesta é "não sei" — e aí o consentimento
 * registrado não vale como prova.
 *
 * Publicar não apaga a versão anterior. Ela continua no banco com
 * `vigente_ate` preenchido, porque os consentimentos antigos apontam para ela.
 */

/** só metadados: o TEXTO é grande e a maioria das telas não precisa dele */
const COLUNAS_META = [
  'id',
  'tipo',
  'versao',
  'titulo',
  'resumo_mudancas',
  'hash_conteudo',
  'vigente_de',
  'vigente_ate',
  'exige_novo_aceite',
  'publicado_por',
  'criado_em',
];

/** a versão em vigor de cada tipo, agora */
async function vigentes() {
  return cache.lembrar(
    chaves.documentosVigentes(),
    async () => {
      const agora = new Date();
      const documentos = await db.DocumentoLegal.findAll({
        where: {
          vigente_de: { [Op.lte]: agora },
          [Op.or]: [{ vigente_ate: null }, { vigente_ate: { [Op.gt]: agora } }],
        },
        attributes: COLUNAS_META,
        order: [['vigente_de', 'DESC']],
      });

      const porTipo = {};
      documentos.forEach((documento) => {
        /* o primeiro de cada tipo é o mais recente pela ordenação acima */
        if (!porTipo[documento.tipo]) porTipo[documento.tipo] = documento.get({ plain: true });
      });
      return porTipo;
    },
    { ttl: TTL_DOCUMENTO }
  );
}

/** o texto integral da versão vigente — é o que a tela de aceite mostra */
async function obter(tipo) {
  const documento = await cache.lembrar(
    chaves.documento(tipo),
    async () => {
      const agora = new Date();
      const encontrado = await db.DocumentoLegal.findOne({
        where: {
          tipo,
          vigente_de: { [Op.lte]: agora },
          [Op.or]: [{ vigente_ate: null }, { vigente_ate: { [Op.gt]: agora } }],
        },
        order: [['vigente_de', 'DESC']],
      });
      return encontrado ? encontrado.get({ plain: true }) : null;
    },
    { ttl: TTL_DOCUMENTO }
  );

  if (!documento) throw erros.naoEncontrado('Documento legal');
  return documento;
}

/** histórico de versões de um tipo — prestação de contas, não navegação */
const historico = (tipo) =>
  db.DocumentoLegal.findAll({
    where: tipo ? { tipo } : {},
    attributes: COLUNAS_META,
    order: [['tipo', 'ASC'], ['vigente_de', 'DESC']],
  });

/**
 * Publica uma nova versão.
 *
 * Transação porque são duas escritas dependentes: encerrar a vigência da
 * versão anterior e criar a nova. Se a segunda falhar sozinha, o sistema fica
 * sem nenhum documento vigente — e a tela de cadastro para de funcionar.
 */
async function publicar(dados, contexto) {
  exigir(contexto, 'lgpd.publicar_documento');

  /**
   * Segunda tranca, temporária e proposital.
   *
   * `lgpd.publicar_documento` é declarada sem escopo em `rbac/recursos.js`, e
   * o papel `usuario` recebe `propriasDoRecurso('lgpd')` — que hoje devolve
   * TODAS as ações do recurso sem escopo `todos`, incluindo esta. Resultado: a
   * checagem acima passa para qualquer usuário cadastrado, e qualquer um
   * publicaria uma versão nova dos Termos de Uso da plataforma.
   *
   * A correção certa é nos arquivos de RBAC, que este módulo não pode editar
   * (está reportado no relatório de entrega). Até lá, exigimos também a
   * capacidade do encarregado — que só existe com escopo `todas` e portanto
   * não vaza pelo mesmo caminho. Quando o RBAC for corrigido, esta linha sai.
   */
  exigir(contexto, 'lgpd.responder_solicitacao');

  const existente = await db.DocumentoLegal.findOne({
    where: { tipo: dados.tipo, versao: dados.versao },
  });
  if (existente) {
    throw erros.conflito('Já existe esta versão deste documento.', {
      tipo: dados.tipo,
      versao: dados.versao,
    });
  }

  const agora = new Date();

  const documento = await db.sequelize.transaction(async (transacao) => {
    await db.DocumentoLegal.update(
      { vigente_ate: agora },
      {
        where: {
          tipo: dados.tipo,
          [Op.or]: [{ vigente_ate: null }, { vigente_ate: { [Op.gt]: agora } }],
        },
        transaction: transacao,
      }
    );

    return db.DocumentoLegal.create(
      {
        tipo: dados.tipo,
        versao: dados.versao,
        titulo: dados.titulo,
        conteudo: dados.conteudo,
        resumo_mudancas: dados.resumoMudancas || null,
        /* hash do texto: prova que a versão aceita em 2026 é byte a byte a que
           está no banco hoje, mesmo que alguém edite a linha sem querer */
        hash_conteudo: sha256(dados.conteudo),
        vigente_de: dados.vigenteDe ? new Date(dados.vigenteDe) : agora,
        vigente_ate: null,
        exige_novo_aceite: dados.exigeNovoAceite !== false,
        publicado_por: contexto.usuarioId,
      },
      { transaction: transacao }
    );
  });

  await cache.invalidar(chaves.dominioDocumentos());
  await cache.remover(chaves.documentosVigentes());

  await auditoria.registrar(contexto, {
    acao: 'publicar',
    entidade: 'documento_legal',
    entidadeId: documento.id,
    depois: { tipo: documento.tipo, versao: documento.versao, hash: documento.hash_conteudo },
    motivo: dados.resumoMudancas || null,
  });

  return documento;
}

/**
 * Consentimentos DESATUALIZADOS de um usuário.
 *
 * É o que permite ao front pedir o reaceite: quando os Termos mudam, o aceite
 * anterior continua válido como prova histórica, mas deixa de valer como
 * autorização para o texto novo. Sem esta checagem, a plataforma opera com
 * milhares de usuários formalmente sob um documento que ninguém aceitou.
 *
 * Uma consulta só, não uma por tipo: são no máximo três documentos, mas o laço
 * com `findOne` dentro é o padrão que vira N+1 quando alguém adicionar o
 * quarto.
 */
async function pendenciasDeAceite(usuarioId) {
  const porTipo = await vigentes();

  /* só os tipos que a tabela de consentimentos aceita: `politica_cookies` é
     documento legal mas não é valor do enum `enum_consentimentos_tipo`, e
     mandá-lo no `IN` derruba a consulta inteira — inclusive a parte que
     verificava os Termos, que é a que trava o cadastro */
  const tipos = Object.keys(porTipo).filter((tipo) =>
    TIPOS_DOCUMENTO_COM_CONSENTIMENTO.includes(tipo)
  );
  if (!tipos.length) return { pendentes: [], bloqueia: false };

  const consentimentos = await db.Consentimento.findAll({
    where: { usuario_id: usuarioId, tipo: { [Op.in]: tipos } },
    attributes: ['tipo', 'aceito', 'versao_documento', 'revogado_em', 'criado_em'],
    order: [['criado_em', 'DESC']],
  });

  /* último registro de cada tipo — a tabela é histórico, o estado atual é a
     linha mais recente */
  const ultimo = {};
  consentimentos.forEach((linha) => {
    if (!ultimo[linha.tipo]) ultimo[linha.tipo] = linha;
  });

  const pendentes = [];

  tipos.forEach((tipo) => {
    const documento = porTipo[tipo];
    const atual = ultimo[tipo];

    const nuncaAceitou = !atual || atual.aceito !== true || atual.revogado_em;
    const versaoDiferente = atual && atual.versao_documento !== documento.versao;

    if (!nuncaAceitou && !versaoDiferente) return;

    /* versão nova sem `exige_novo_aceite` é correção de vírgula: registramos
       como desatualizado para a tela informar, mas não travamos o uso */
    const obrigatorio =
      DOCUMENTOS_DE_ACEITE_OBRIGATORIO.includes(tipo) &&
      (nuncaAceitou || documento.exige_novo_aceite);

    pendentes.push({
      tipo,
      motivo: nuncaAceitou ? 'nunca_aceito' : 'consentimento_desatualizado',
      versaoAceita: atual?.versao_documento || null,
      versaoVigente: documento.versao,
      titulo: documento.titulo,
      resumoMudancas: documento.resumo_mudancas,
      exigeNovoAceite: Boolean(documento.exige_novo_aceite),
      obrigatorio,
    });
  });

  return { pendentes, bloqueia: pendentes.some((item) => item.obrigatorio) };
}

module.exports = { vigentes, obter, historico, publicar, pendenciasDeAceite, COLUNAS_META };
