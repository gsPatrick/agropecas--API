'use strict';

const db = require('../../models');
const { erros } = require('../../utils/erros');
const auditoria = require('../auditoria/auditoria.service');
const limite = require('./contato.limite.service');
const registroService = require('./contato.registro.service');
const { CANAL, MOTIVO_ACESSO, RECURSO_ACESSO } = require('./contato.constants');

/**
 * Revelar o contato do anunciante — o endpoint mais sensível do sistema.
 *
 * É aqui que a regra da cliente vira código. Três coisas acontecem, nesta
 * ordem, e a ordem é a regra de segurança:
 *
 *   1. **cota** — antes de tocar no banco, porque negar depois de consultar já
 *      teria pago o custo que o raspador queria impor;
 *   2. **consentimento** — `exibir_whatsapp = false` significa que o número
 *      NÃO sai. Nem aqui, nem com permissão de Admin, nem "só para quem já
 *      conversou". É consentimento LGPD (art. 8º), não preferência de UI, e o
 *      lugar certo de checar é o servidor: esconder o botão no front deixaria
 *      o número na resposta da API para quem abrisse o DevTools;
 *   3. **rastro** — a leitura fica em `logs_acesso_dado`. Ver dado pessoal de
 *      terceiro é evento auditável mesmo quando é legítimo, e é justamente a
 *      leitura que gera o risco (ver `documentacao/models/LGPD.md`, §2).
 *
 * **Exige login.** A justificativa completa está em
 * `documentacao/features/Contato.md`, §"Por que revelar contato exige conta" —
 * em uma linha: sem conta não há a quem limitar, e um endpoint anônimo que
 * devolve telefone é uma API de exportação da base de anunciantes.
 */

/**
 * Carrega anúncio + perfil do anunciante numa consulta.
 *
 * `attributes` explícito nos dois lados: `anuncios.descricao` e `perfis.bio`
 * são TEXT e não têm nada a ver com revelar um telefone. O documento
 * (CPF/CNPJ) não entra na lista nem por engano — não existe caminho em que
 * esta rota precise dele.
 */
async function carregar(anuncioId) {
  const anuncio = await db.Anuncio.findByPk(anuncioId, {
    attributes: ['id', 'usuario_id', 'perfil_id', 'titulo', 'codigo', 'status'],
    include: [
      {
        model: db.Perfil,
        as: 'perfil',
        required: false,
        attributes: [
          'id',
          'nome_exibicao',
          'slug',
          'whatsapp',
          'telefone_secundario',
          'exibir_whatsapp',
          'aceita_chat',
        ],
      },
    ],
  });

  if (!anuncio) throw erros.naoEncontrado('Anúncio');
  return anuncio;
}

/**
 * @returns {{whatsapp: string|null, exibirWhatsapp: boolean, aceitaChat: boolean}}
 */
async function revelar(contexto, { anuncioId, origem }) {
  if (!contexto?.autenticado) {
    throw erros.naoAutenticado('Entre para ver o contato do anunciante.');
  }

  /* cota primeiro: negar só depois da consulta já teria servido o custo que
     o raspador queria impor, e teria vazado por tempo de resposta quais
     anúncios existem */
  const cota = await limite.consumirRevelacao(contexto);

  const anuncio = await carregar(anuncioId);
  const perfil = anuncio.perfil;
  const proprio = String(anuncio.usuario_id) === String(contexto.usuarioId);

  const exibirWhatsapp = Boolean(perfil?.exibir_whatsapp);
  const aceitaChat = perfil ? Boolean(perfil.aceita_chat) : true;

  /* o consentimento é a chave: sem ele o campo sai NULO, não vazio nem
     mascarado. Mascarar ("(65) 9****-1234") pareceria proteção e entregaria
     DDD, operadora e os quatro dígitos finais — o bastante para cruzar com
     outra base */
  const numero = exibirWhatsapp
    ? perfil?.whatsapp || perfil?.telefone_secundario || null
    : null;

  /* ver o próprio contato não é acesso a dado de terceiro: não há titular
     alheio, não há log de acesso e não há contato a registrar */
  if (!proprio) {
    await registrarAcesso(contexto, anuncio, { revelado: Boolean(numero), origem });

    if (numero) {
      await registroService.registrar(contexto, {
        anuncioId: anuncio.id,
        canal: CANAL.WHATSAPP,
        origem: origem || 'detalhe',
      });
    }
  }

  return {
    anuncioId: anuncio.id,
    anunciante: perfil
      ? { perfilId: perfil.id, nome: perfil.nome_exibicao, slug: perfil.slug }
      : null,
    whatsapp: numero,
    exibirWhatsapp,
    /* o front precisa saber o que oferecer quando o número não sai: o chat
       interno existe justamente para quem não quer expor o telefone
       (Maturacao/05, §8.1) */
    aceitaChat,
    revelacoesRestantes: cota.restantes,
  };
}

/**
 * Grava a leitura.
 *
 * Duas trilhas, de propósito:
 *
 * - `logs_acesso_dado` é a exigida pela LGPD e responde "quem abriu o telefone
 *   de quem". Ela é gravada **mesmo quando o número não saiu**: a tentativa faz
 *   parte da apuração de assédio, e um log que só registra sucesso não mostra
 *   quem estava varrendo a base;
 * - `logs_auditoria` só quando é um Admin usando poder amplo sobre registro de
 *   terceiro — o rastro que `RBAC.md` §2 cobra do coringa.
 */
async function registrarAcesso(contexto, anuncio, { revelado, origem }) {
  try {
    await db.LogAcessoDado.create({
      ator_id: contexto.usuarioId,
      titular_id: anuncio.usuario_id,
      recurso: RECURSO_ACESSO,
      recurso_id: anuncio.id,
      motivo: `${MOTIVO_ACESSO}:${revelado ? 'exibido' : 'negado_por_consentimento'}${
        origem ? `:${origem}` : ''
      }`,
      ip_hash: contexto.ipHash || null,
      user_agent: contexto.userAgent || null,
    });
  } catch (erro) {
    /* mesma política do `auditoria.service`: log perdido é ruim, impedir o
       usuário de ver o contato porque o log falhou é pior */
    console.error('[contato] falha ao registrar acesso a dado pessoal:', erro.message);
  }

  if (contexto.admin) {
    await auditoria.registrar(contexto, {
      acao: 'contato.revelado',
      entidade: 'anuncios',
      entidadeId: anuncio.id,
      motivo: MOTIVO_ACESSO,
    });
  }
}

module.exports = { revelar, carregar };
