'use strict';

/**
 * Objeto interno → JSON da API.
 *
 * O item que sai da leitura já é um objeto simples (não uma instância do
 * Sequelize), mas ainda carrega campos que a API não deve publicar: `bruto` é o
 * valor como está no JSONB, útil para depurar e irrelevante para o cliente —
 * expor os dois convida o front a escolher o errado.
 */

/** item completo — telas de admin, exige `configuracao.ler` */
const item = (registro) => {
  if (!registro) return null;
  return {
    chave: registro.chave,
    valor: registro.valor,
    tipo: registro.tipo,
    grupo: registro.grupo,
    descricao: registro.descricao,
    publica: registro.publica,
    atualizadoEm: registro.atualizadoEm,
  };
};

const lista = (itens) => (itens || []).map(item);

/**
 * Formato agrupado que a tela de configurações consome direto.
 * Agrupar no servidor evita que cada cliente reimplemente o mesmo `reduce`.
 */
const porGrupo = (itens) =>
  (itens || []).reduce((acumulado, registro) => {
    (acumulado[registro.grupo] = acumulado[registro.grupo] || []).push(item(registro));
    return acumulado;
  }, {});

/**
 * Linha do histórico. `ator_id` sai porque a tela precisa dizer quem mudou;
 * `ip_hash` e `user_agent` NÃO saem — estão na trilha para investigação, não
 * para exibição, e são dado pessoal de um funcionário (LGPD).
 */
const historico = (registro) => ({
  id: registro.id,
  autorId: registro.ator_id,
  autorPapel: registro.ator_papel,
  de: registro.antes?.valor ?? null,
  para: registro.depois?.valor ?? null,
  motivo: registro.motivo,
  em: registro.criado_em,
});

module.exports = { item, lista, porGrupo, historico };
