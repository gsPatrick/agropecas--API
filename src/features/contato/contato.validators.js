'use strict';

const { campos, esquema } = require('../../validacao');
const { CANAIS, ORIGENS } = require('./contato.constants');

/**
 * Esquemas de entrada da feature.
 *
 * O que NÃO aparece aqui é tão importante quanto o que aparece: não existe
 * `interessadoId`, `anuncianteId` nem `ipHash` no corpo. Todos os três saem do
 * `contexto` — aceitar qualquer um deles do cliente permitiria forjar contato
 * em nome de terceiro e envenenar a métrica que a cliente usa para decidir se
 * a plataforma funciona.
 */

const anuncioNaRota = esquema({
  anuncioId: campos.uuid().obrigatorio('Identificador inválido.'),
});

const registrar = esquema({
  canal: campos.umDe(CANAIS).obrigatorio('Informe o canal do contato.').rotulo('canal'),
  /* `umDe` e não texto livre: origem alimenta relatório, e campo livre vira
     dez grafias da mesma tela em três meses */
  origem: campos.umDe(ORIGENS),
  conversaId: campos.uuid(),
});

const revelar = esquema({ origem: campos.umDe(ORIGENS) });

const listarRecebidos = esquema({
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
  canal: campos.umDe(CANAIS),
  desde: campos.data(),
  ate: campos.data(),
});

const listarMeus = esquema({
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
  canal: campos.umDe(CANAIS),
});

const metricas = esquema({
  desde: campos.data(),
  ate: campos.data(),
});

module.exports = { anuncioNaRota, registrar, revelar, listarRecebidos, listarMeus, metricas };
