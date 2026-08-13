'use strict';

const db = require('../../models');
const auditoria = require('../auditoria/auditoria.service');
const { erros } = require('../../utils/erros');
const leitura = require('./configuracao.leitura.service');
const tipoService = require('./configuracao.tipo.service');
const { ACAO_AUDITORIA, ENTIDADE } = require('./configuracao.constants');

/**
 * Escrita das configurações.
 *
 * Três decisões que valem explicação:
 *
 * 1. **Não cria chave.** Chave inexistente é 404, nunca `upsert`. Uma tabela de
 *    configuração que aceita chave nova por PUT vira lixeira: `anuncio.max_foto`
 *    (sem o "s") convive em paz com `anuncio.max_fotos`, e o código continua
 *    lendo a certa enquanto a Admin edita a errada — sem nenhum erro na tela.
 *    Chave nova entra por seed/migration, com tipo e descrição definidos.
 *
 * 2. **Tipo é validado antes de gravar** (`configuracao.tipo.service`).
 *
 * 3. **Toda alteração vai para `logs_auditoria`** com valor antes e depois. A
 *    cliente pode mudar tudo — é o produto dela —, mas quando um limite
 *    aparecer estranho daqui a três meses, a pergunta "quem mudou e para quê"
 *    precisa de resposta.
 */

/** confere existência antes de qualquer coisa — sem criação silenciosa */
async function exigirChave(chave) {
  const registro = await db.Configuracao.findOne({ where: { chave } });
  if (!registro) throw erros.naoEncontrado('Configuração');
  return registro;
}

/**
 * Grava uma configuração. Devolve o registro já no formato de leitura.
 *
 * @param contexto  contexto da requisição (autor da mudança, IP em hash)
 * @param motivo    texto livre opcional que a tela do admin pode pedir
 */
async function definir(contexto, { chave, valor, motivo }) {
  const registro = await exigirChave(chave);

  const anterior = tipoService.converter(registro.valor, registro.tipo);
  const novo = tipoService.validar(valor, registro.tipo, chave);

  /* gravação sem mudança não é erro, mas também não polui a auditoria: quem
     abre a tela, salva e sai não deveria gerar linha de trilha */
  if (JSON.stringify(anterior) === JSON.stringify(novo)) {
    await leitura.invalidar();
    return leitura.detalhe(chave);
  }

  await registro.update({ valor: novo, atualizado_por: contexto?.usuarioId || null });

  /* invalidar ANTES de responder: a Admin muda um limite e recarrega a tela no
     segundo seguinte — se o cache ainda servisse o valor antigo, ela clicaria
     em salvar de novo achando que não pegou */
  await leitura.invalidar();

  await auditoria.registrar(contexto, {
    acao: ACAO_AUDITORIA,
    entidade: ENTIDADE,
    entidadeId: registro.id,
    antes: { chave, valor: anterior },
    depois: { chave, valor: novo },
    motivo: motivo || null,
  });

  return leitura.detalhe(chave);
}

/**
 * Escrita em lote — a tela de configurações salva um grupo inteiro de uma vez.
 *
 * Em transação: metade das configurações salvas é pior que nenhuma, porque a
 * Admin não tem como saber quais pegaram. Validação de TODAS antes de gravar
 * qualquer uma, para que um tipo errado no último campo não deixe os anteriores
 * já escritos.
 */
async function definirVarias(contexto, itens) {
  const registros = new Map();

  for (const item of itens) {
    const registro = await exigirChave(item.chave);
    tipoService.validar(item.valor, registro.tipo, item.chave);
    registros.set(item.chave, registro);
  }

  const alteradas = [];

  await db.sequelize.transaction(async (transacao) => {
    for (const item of itens) {
      const registro = registros.get(item.chave);
      const anterior = tipoService.converter(registro.valor, registro.tipo);
      const novo = tipoService.validar(item.valor, registro.tipo, item.chave);

      if (JSON.stringify(anterior) === JSON.stringify(novo)) continue;

      await registro.update(
        { valor: novo, atualizado_por: contexto?.usuarioId || null },
        { transaction: transacao }
      );

      alteradas.push({ registro, chave: item.chave, anterior, novo });
    }
  });

  await leitura.invalidar();

  /* auditoria fora da transação: um log que falha não pode desfazer a mudança
     que a Admin já viu acontecer (ver auditoria.service) */
  for (const alterada of alteradas) {
    await auditoria.registrar(contexto, {
      acao: ACAO_AUDITORIA,
      entidade: ENTIDADE,
      entidadeId: alterada.registro.id,
      antes: { chave: alterada.chave, valor: alterada.anterior },
      depois: { chave: alterada.chave, valor: alterada.novo },
    });
  }

  return leitura.listar();
}

module.exports = { definir, definirVarias, exigirChave };
