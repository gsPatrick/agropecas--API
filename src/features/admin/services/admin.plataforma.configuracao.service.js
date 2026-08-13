'use strict';

const leitura = require('../../configuracao/configuracao.leitura.service');
const escrita = require('../../configuracao/configuracao.escrita.service');
const historicoService = require('../../configuracao/configuracao.historico.service');
const configuracaoMapper = require('../../configuracao/configuracao.mapper');

/**
 * Configuração pela tela do Admin.
 *
 * **Composição, não cópia.** Salvar continua sendo
 * `configuracao.escrita.service.definir` — é lá que mora a recusa de criar
 * chave nova, a validação de tipo, a invalidação do cache e o registro em
 * `logs_auditoria`. Reimplementar qualquer um desses passos aqui criaria dois
 * caminhos de escrita para a mesma tabela, e um dia eles divergiriam
 * exatamente no passo que ninguém lembra: a auditoria.
 *
 * O que o painel acrescenta é a **máscara de valor sensível na listagem** —
 * ver `MASCARAVEL` abaixo.
 */

/**
 * Chaves cujo VALOR não é impresso na listagem.
 *
 * A feature `configuracao` já tem uma lista branca (`PUBLICAS`) para a rota
 * aberta, e ela continua valendo — este módulo nunca serve configuração a quem
 * não tem `configuracao.ler`. O problema que sobra é outro: a tela do Admin
 * lista TUDO de uma vez, e uma tela que imprime segredo em texto puro vaza por
 * captura de tela, por print colado no WhatsApp do suporte e por gravação de
 * sessão — sem nenhuma falha de permissão envolvida.
 *
 * Por isso o padrão da listagem é conservador: quem precisa do valor abre a
 * chave (rota de detalhe da própria feature) e esse acesso é pontual.
 *
 * Reconhecimento por padrão no nome e não por lista fechada: chave nova com
 * "segredo" no nome nasce protegida, sem depender de alguém lembrar de
 * cadastrá-la aqui. O contrário — lista fechada — falha em silêncio, e a falha
 * só aparece depois do vazamento.
 */
const MASCARAVEL = /(segredo|secret|senha|password|token|credencial|api_key|chave_api|webhook|smtp)/i;

const ehSensivel = (chave) => MASCARAVEL.test(String(chave || ''));

/**
 * Lista branca da resposta.
 *
 * Reusa o mapper da feature (mesmo formato em toda a API) e acrescenta só o
 * que a tela do painel precisa saber: se o valor foi escondido e por quê. O
 * campo `bruto` — o JSONB como está no banco — nunca sai: expor o valor duas
 * vezes convida o front a ler o que não foi mascarado.
 */
const paraTela = (registro) => {
  const base = configuracaoMapper.item(registro);
  if (!base) return null;

  if (!ehSensivel(base.chave)) return { ...base, sensivel: false, mascarado: false };

  return {
    ...base,
    valor: null,
    sensivel: true,
    mascarado: true,
  };
};

/** todas as configurações, agrupadas como a tela consome */
async function listar(contexto, { grupo } = {}) {
  const itens = await leitura.listar({ grupo });
  const visiveis = itens.map(paraTela);

  const porGrupo = visiveis.reduce((acumulado, item) => {
    (acumulado[item.grupo] = acumulado[item.grupo] || []).push(item);
    return acumulado;
  }, {});

  return {
    itens: visiveis,
    grupos: Object.keys(porGrupo).sort(),
    /* a tela avisa que existe valor escondido em vez de fingir que a chave não
       tem valor nenhum — Admin que não sabe que há algo ali edita às cegas */
    mascaradas: visiveis.filter((item) => item.mascarado).length,
  };
}

/**
 * Salva uma chave.
 *
 * A auditoria é gravada por `configuracao.escrita.service` (com valor antes e
 * depois). Registrar de novo aqui, pelo helper do painel, produziria duas
 * linhas para o mesmo fato — e a trilha da configuração é lida pelo histórico,
 * que passaria a mostrar cada alteração em dobro.
 */
async function salvar(contexto, { chave, valor, motivo }) {
  const atualizada = await escrita.definir(contexto, { chave, valor, motivo });
  return paraTela(atualizada);
}

/** histórico de uma chave — a trilha já é `logs_auditoria`, aqui é só o recorte */
async function historico(contexto, chave, query = {}) {
  const registro = await escrita.exigirChave(chave); // 404 quando a chave não existe

  const { itens, pagina, porPagina, total } = await historicoService.listar(registro.id, query);

  /* valor sensível também não aparece no histórico: senão o diff entrega o
     que a listagem escondeu */
  const linhas = itens.map(configuracaoMapper.historico).map((linha) =>
    ehSensivel(chave) ? { ...linha, de: null, para: null, mascarado: true } : { ...linha, mascarado: false }
  );

  return { itens: linhas, pagina, porPagina, total };
}

module.exports = { listar, salvar, historico, ehSensivel, paraTela };
