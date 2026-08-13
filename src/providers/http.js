'use strict';

const { AppError } = require('../utils/erros');

/**
 * Cliente HTTP mínimo dos providers.
 *
 * Existe por um motivo só: **timeout**. `fetch` sem `AbortSignal` espera para
 * sempre, e integrações públicas e gratuitas (ViaCEP, BigDataCloud) não caem —
 * elas travam. Uma conexão pendurada segura o worker, a requisição do usuário
 * não responde nunca e o problema aparece como "o site está lento", não como
 * "o terceiro está fora".
 *
 * Toda falha de rede vira `AppError` 503 com `esperado: true`, para o
 * middleware de erro traduzir sem virar 500 e sem stack no log de produção.
 */

const CODIGO_INDISPONIVEL = 'INTEGRACAO_INDISPONIVEL';

const indisponivel = (servico, motivo) =>
  new AppError(
    `O serviço de ${servico} está indisponível no momento. Preencha os dados manualmente.`,
    503,
    CODIGO_INDISPONIVEL,
    { servico, motivo }
  );

/**
 * GET que devolve JSON.
 *
 * @param opcoes.servico    nome legível, usado na mensagem ao usuário
 * @param opcoes.timeoutMs  teto de espera; estourou, é como se estivesse fora
 */
async function obterJson(url, { servico = 'externo', timeoutMs = 4000, cabecalhos = {} } = {}) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), timeoutMs);

  try {
    const resposta = await fetch(url, {
      method: 'GET',
      signal: controle.signal,
      headers: { accept: 'application/json', 'user-agent': 'AgroPecasMT/1.0', ...cabecalhos },
    });

    /* 404 é resposta de negócio ("não achei esse CEP"), não indisponibilidade:
       quem chamou decide o que fazer, e não faz sentido pedir para o usuário
       "tentar mais tarde" um CEP que não existe */
    if (resposta.status === 404) return { encontrado: false, status: 404, dados: null };

    if (!resposta.ok) throw indisponivel(servico, `http_${resposta.status}`);

    const dados = await resposta.json().catch(() => {
      throw indisponivel(servico, 'resposta_ilegivel');
    });

    return { encontrado: true, status: resposta.status, dados };
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    throw indisponivel(servico, erro.name === 'AbortError' ? 'timeout' : erro.message);
  } finally {
    clearTimeout(relogio);
  }
}

module.exports = { obterJson, indisponivel, CODIGO_INDISPONIVEL };
