'use strict';

/**
 * Cálculo do balde de medição.
 *
 * Um limite `por_mes` não conta desde sempre: ele conta dentro do mês
 * corrente. `usos_medidos` guarda uma linha por (usuário, chave,
 * periodo_inicio) justamente para isso — virar o mês é começar a gravar em
 * outra linha, sem apagar nada e sem job de reset. O histórico fica.
 *
 * As datas são calculadas em UTC de propósito. MT é UTC-4 o ano inteiro (não
 * há horário de verão desde 2019), mas misturar fuso local do servidor com
 * `DATEONLY` do Postgres faria o balde virar em horários diferentes conforme
 * o container — e um contador que zera duas vezes é pior que um que zera na
 * hora errada.
 */

const SENTINELA_TOTAL = '1970-01-01';

const iso = (data) => data.toISOString().slice(0, 10);

/**
 * @param periodo  'total' | 'dia' | 'semana' | 'mes'
 * @returns { inicio, fim } em `YYYY-MM-DD`; `fim` é null para 'total'
 */
function balde(periodo, referencia = new Date()) {
  const d = new Date(
    Date.UTC(referencia.getUTCFullYear(), referencia.getUTCMonth(), referencia.getUTCDate())
  );

  if (periodo === 'dia') {
    return { inicio: iso(d), fim: iso(d) };
  }

  if (periodo === 'semana') {
    /* semana começa na segunda: é como o comércio conta, e o relatório de
       desempenho compara semana a semana */
    const diaDaSemana = (d.getUTCDay() + 6) % 7;
    const inicio = new Date(d);
    inicio.setUTCDate(d.getUTCDate() - diaDaSemana);
    const fim = new Date(inicio);
    fim.setUTCDate(inicio.getUTCDate() + 6);
    return { inicio: iso(inicio), fim: iso(fim) };
  }

  if (periodo === 'mes') {
    const inicio = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { inicio: iso(inicio), fim: iso(fim) };
  }

  /* 'total' é quota de estado, não de fluxo: "quantos anúncios ativos AGORA".
     Uma linha única por usuário/chave, que sobe ao publicar e desce ao
     despublicar. A sentinela é só um valor estável para a chave única. */
  return { inicio: SENTINELA_TOTAL, fim: null };
}

module.exports = { balde, SENTINELA_TOTAL };
