'use strict';

const { campos, esquema } = require('../../validacao');
const { ANUNCIO_STATUS, MODERACAO_STATUS } = require('../../models/constantes');
const { MOTIVO_MINIMO, SUSPENSAO } = require('./moderacao.constants');

/**
 * Esquemas de entrada.
 *
 * O `motivo` obrigatório aparece em quatro esquemas e é o mesmo em todos —
 * declarado uma vez e reaproveitado. O construtor de `campos` é imutável, então
 * compartilhar a base não vaza estado entre esquemas.
 *
 * Exigir motivo **na validação** e não só no service é deliberado: assim a
 * recusa vem como 422 com o campo apontado, que é o que o front sabe exibir,
 * em vez de um 400 genérico depois de meio caminho de regra de negócio.
 */

const motivoObrigatorio = () =>
  campos
    .textoLongo()
    .obrigatorio('Informe o motivo — ação de moderação sem justificativa não é registrada.')
    .min(MOTIVO_MINIMO, 'Descreva o motivo com um pouco mais de detalhe.')
    .max(2000);

const identificador = esquema({ id: campos.uuid().obrigatorio('Identificador inválido.') });

const paginacao = esquema({
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
});

const fila = esquema({
  moderacaoStatus: campos.umDe(MODERACAO_STATUS),
  status: campos.umDe(ANUNCIO_STATUS),
  /* só o que tem denúncia aberta — o corte que o moderador com pouco tempo faz */
  somenteDenunciados: campos.booleano(),
  uf: campos.texto().min(2).max(2),
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
});

/** aprovar dispensa motivo: elogiar não precisa de justificativa, punir precisa */
const aprovar = esquema({
  observacao: campos.textoLongo().max(2000),
  denunciaId: campos.uuid(),
});

const reprovar = esquema({
  motivo: motivoObrigatorio(),
  denunciaId: campos.uuid(),
});

const ocultar = esquema({
  motivo: motivoObrigatorio(),
  denunciaId: campos.uuid(),
});

const bloquearFoto = esquema({
  motivo: motivoObrigatorio(),
  denunciaId: campos.uuid(),
});

const suspender = esquema({
  motivo: motivoObrigatorio(),
  dias: campos
    .inteiro()
    .min(1)
    .max(SUSPENSAO.DIAS_MAXIMO)
    .padrao(SUSPENSAO.DIAS_PADRAO),
  denunciaId: campos.uuid(),
});

const banir = esquema({
  motivo: motivoObrigatorio(),
  denunciaId: campos.uuid(),
});

const restaurar = esquema({
  motivo: motivoObrigatorio(),
});

module.exports = {
  identificador,
  paginacao,
  fila,
  aprovar,
  reprovar,
  ocultar,
  bloquearFoto,
  suspender,
  banir,
  restaurar,
};
