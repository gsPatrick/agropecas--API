'use strict';

const { erros } = require('../../utils/erros');
const { PERIODO_MAX_DIAS, MINIMO_AGREGACAO, TOP_MAXIMO, TOP_PADRAO } = require('./relatorio.constants');

/**
 * Peças compartilhadas por todos os relatórios: período com teto, período
 * anterior para comparação, e supressão de recorte pequeno.
 *
 * Ficam num arquivo comum e não repetidas em cada service porque são as duas
 * regras que a revisão vai conferir em TODO relatório — se estiverem copiadas,
 * o terceiro relatório escrito com pressa vai esquecer uma delas.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Normaliza a entrada para meia-noite UTC daquele dia.
 *
 * A entrada chega em dois formatos: `Date` quando veio de `campos.data()` pelo
 * middleware, e string `YYYY-MM-DD` quando veio do job da fila. Converter os
 * dois para o mesmo ponto do dia é o que faz o relatório da tela e o da
 * exportação devolverem exatamente o mesmo número.
 */
const somenteData = (valor) => {
  const texto = valor instanceof Date ? valor.toISOString() : String(valor);
  return new Date(`${texto.slice(0, 10)}T00:00:00.000Z`);
};

const iso = (data) => data.toISOString().slice(0, 10);

/**
 * Lê e valida o período da consulta.
 *
 * Período é **obrigatório** — não há padrão "desde sempre". Um relatório sem
 * recorte é o pedido que trava o banco, e ele nunca chega por má-fé: chega
 * porque o front esqueceu de mandar o filtro.
 *
 * @returns { de, ate, dias, anterior: { de, ate } }
 *          `de`/`ate` são Date em UTC; `ate` é exclusivo no fim do dia.
 */
function lerPeriodo(query = {}, { maxDias = PERIODO_MAX_DIAS } = {}) {
  if (!query.de || !query.ate) {
    throw erros.invalido('Informe o período do relatório (de e ate).', {
      campos: { de: 'Data inicial obrigatória.', ate: 'Data final obrigatória.' },
    });
  }

  const de = somenteData(query.de);
  const ate = somenteData(query.ate);

  if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) {
    throw erros.invalido('Datas do período inválidas.');
  }
  if (ate < de) throw erros.invalido('A data final não pode ser anterior à inicial.');

  const dias = Math.floor((ate - de) / DIA_MS) + 1;
  if (dias > maxDias) {
    throw erros.invalido(
      `O período máximo por consulta é de ${maxDias} dias. Para séries maiores, use a exportação.`,
      { dias, maximo: maxDias }
    );
  }

  /* período anterior de MESMO tamanho, imediatamente antes: é a única
     comparação honesta. Comparar com "o mês passado" quando o recorte tem 10
     dias produziria a queda de 70% que não existe */
  const anteriorAte = new Date(de.getTime() - DIA_MS);
  const anteriorDe = new Date(anteriorAte.getTime() - (dias - 1) * DIA_MS);

  return {
    de,
    ate,
    dias,
    /* fim exclusivo para as colunas DATE/TIMESTAMP: `criado_em < ate+1d` pega
       o dia inteiro sem depender do horário gravado */
    ateExclusivo: new Date(ate.getTime() + DIA_MS),
    diaDe: iso(de),
    diaAte: iso(ate),
    anterior: {
      de: anteriorDe,
      ate: anteriorAte,
      ateExclusivo: new Date(anteriorAte.getTime() + DIA_MS),
      diaDe: iso(anteriorDe),
      diaAte: iso(anteriorAte),
    },
  };
}

/** teto de linhas em qualquer "top N" */
const lerTop = (valor) => Math.min(TOP_MAXIMO, Math.max(1, Number(valor) || TOP_PADRAO));

/**
 * Remove da lista os recortes pequenos demais para serem publicados.
 *
 * Devolve `{ itens, ocultados }` — o total suprimido volta agregado para que
 * quem lê saiba que a lista tem cauda, sem que a cauda seja revelada.
 *
 * Só aplicar em recorte que fala de PESSOA (termo de busca, localidade). Ver
 * a justificativa em `relatorio.constants.js`.
 */
function suprimirPequenos(itens, contar, { minimo = MINIMO_AGREGACAO } = {}) {
  const visiveis = [];
  let ocultados = 0;
  let ocultadosLinhas = 0;

  itens.forEach((item) => {
    const total = Number(contar(item)) || 0;
    if (total >= minimo) visiveis.push(item);
    else {
      ocultados += total;
      ocultadosLinhas += 1;
    }
  });

  return { itens: visiveis, ocultados, ocultadosLinhas, minimo };
}

/** variação percentual entre período atual e anterior, protegida contra /0 */
function variacao(atual, anterior) {
  const a = Number(atual) || 0;
  const b = Number(anterior) || 0;

  if (b === 0) return a === 0 ? 0 : null; // null = "não havia base de comparação"
  return Math.round(((a - b) / b) * 1000) / 10;
}

const numero = (valor) => Number(valor || 0);

module.exports = { lerPeriodo, lerTop, suprimirPequenos, variacao, numero, iso };
