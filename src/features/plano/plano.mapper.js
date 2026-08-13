'use strict';

/**
 * Model → JSON, por lista branca.
 *
 * A tabela de preços é rota PÚBLICA: campo novo em `planos` não pode aparecer
 * no site porque alguém rodou uma migration. `referencia_externa` da
 * assinatura (id no futuro gateway) nunca sai daqui — é identificador de
 * sistema de terceiro e não interessa a nenhum cliente da API.
 */

const numero = (valor) => (valor === null || valor === undefined ? null : Number(valor));

const limite = (registro) =>
  registro && {
    chave: registro.chave,
    /* `null` viaja como null e é documentado como ILIMITADO. Já foi tentador
       mandar -1 ou 0; os dois se confundem com "nenhum" na tela */
    valor: numero(registro.valor),
    ilimitado: registro.valor === null || registro.valor === undefined,
    periodo: registro.periodo,
    descricao: registro.descricao || null,
  };

const plano = (registro) =>
  registro && {
    id: registro.id,
    chave: registro.chave,
    nome: registro.nome,
    descricao: registro.descricao || null,
    precoCentavos: numero(registro.preco_centavos),
    periodicidade: registro.periodicidade,
    diasTeste: numero(registro.dias_teste),
    padrao: Boolean(registro.padrao),
    ativo: Boolean(registro.ativo),
    ordem: numero(registro.ordem),
    limites: (registro.limites || []).map(limite),
  };

/** o Admin vê também o que a vitrine esconde */
const planoAdmin = (registro) =>
  registro && { ...plano(registro), publico: Boolean(registro.publico) };

const assinatura = (registro) =>
  registro && {
    id: registro.id,
    status: registro.status,
    inicioEm: registro.inicio_em,
    fimEm: registro.fim_em,
    renovaEm: registro.renova_em,
    canceladaEm: registro.cancelada_em,
    origem: registro.origem,
    plano: registro.plano ? plano(registro.plano) : undefined,
  };

/** linha da tela "meu uso": o que o anunciante precisa para entender o teto */
const uso = (item) =>
  item && {
    chave: item.chave,
    descricao: item.descricao,
    periodo: item.periodo,
    periodoInicio: item.periodoInicio,
    periodoFim: item.periodoFim,
    limite: item.limite,
    ilimitado: item.ilimitado,
    usado: item.usado,
    restante: item.restante,
  };

const minhaAssinatura = ({ assinatura: registro, plano: efetivo, uso: itens }) => ({
  /* `origem: 'padrao'` é informação útil para a tela: diz que a pessoa está no
     gratuito por ausência de assinatura, e não por escolha registrada */
  origem: efetivo.origem,
  planoChave: efetivo.planoChave,
  planoNome: efetivo.planoNome,
  assinatura: registro ? assinatura(registro) : null,
  uso: (itens || []).map(uso),
});

module.exports = { plano, planoAdmin, limite, assinatura, uso, minhaAssinatura };
