'use strict';

/**
 * Cache em memória — o padrão quando não há Redis.
 *
 * Serve desenvolvimento e instância única. Não serve produção com mais de um
 * processo: cada um teria sua cópia, e invalidar em um não invalidaria no
 * outro. É por isso que o boot avisa quando produção sobe sem Redis.
 */

const armazem = new Map();

/* varredura preguiçosa: sem ela o Map só cresce e vira vazamento */
const LIMPEZA_MS = 60 * 1000;
setInterval(() => {
  const agora = Date.now();
  armazem.forEach((registro, chave) => {
    if (registro.expiraEm && registro.expiraEm <= agora) armazem.delete(chave);
  });
}, LIMPEZA_MS).unref();

module.exports = {
  nome: 'memoria',

  async obter(chave) {
    const registro = armazem.get(chave);
    if (!registro) return undefined;

    if (registro.expiraEm && registro.expiraEm <= Date.now()) {
      armazem.delete(chave);
      return undefined;
    }
    return registro.valor;
  },

  async gravar(chave, valor, ttlSegundos) {
    armazem.set(chave, {
      valor,
      expiraEm: ttlSegundos ? Date.now() + ttlSegundos * 1000 : null,
    });
  },

  async remover(chaves) {
    chaves.forEach((chave) => armazem.delete(chave));
  },

  async removerPorPadrao(padrao) {
    const expressao = new RegExp(`^${padrao.replace(/\*/g, '.*')}$`);
    let removidas = 0;

    armazem.forEach((_, chave) => {
      if (expressao.test(chave)) {
        armazem.delete(chave);
        removidas += 1;
      }
    });
    return removidas;
  },

  async incrementar(chave, quanto, ttlSegundos) {
    const atual = (await this.obter(chave)) || 0;
    const novo = atual + quanto;
    const registro = armazem.get(chave);

    /* preserva o vencimento original: renovar a cada incremento faria uma
       janela de rate limit nunca fechar sob tráfego contínuo */
    armazem.set(chave, {
      valor: novo,
      expiraEm: registro?.expiraEm || (ttlSegundos ? Date.now() + ttlSegundos * 1000 : null),
    });
    return novo;
  },

  async ttl(chave) {
    const registro = armazem.get(chave);
    if (!registro?.expiraEm) return -1;
    return Math.max(0, Math.ceil((registro.expiraEm - Date.now()) / 1000));
  },

  async limpar() {
    armazem.clear();
  },
};
