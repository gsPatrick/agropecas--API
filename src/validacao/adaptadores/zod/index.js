'use strict';

const { z } = require('zod');
const { construir } = require('./tipos');
const { aplicar: aplicarRegras } = require('./regras');
const { traduzir } = require('./erros');
const { aplicar: aplicarTransformacoes } = require('../../transformacoes');

/**
 * Adaptador zod — implementa `contrato.js`.
 *
 * Junta as peças: tipo → regras → transformações → presença. A ordem importa e
 * está fixada aqui:
 *
 *   1. transformar (aparar, minúsculas, E.164) — o valor chega "limpo";
 *   2. validar tipo e regras sobre o valor já limpo;
 *   3. resolver presença (obrigatório, nulo, padrão).
 *
 * Validar antes de transformar reprovaria `" JOAO@X.COM "`, que é um e-mail
 * perfeitamente válido escrito por alguém com o dedo pesado.
 */

/* referência viva ao corpo em validação: regras como `igualA` precisam ver os
   outros campos, e o zod entrega valor a valor */
const corpoRef = { atual: {} };

function compilarCampo(spec) {
  let esquema = construir(spec, compilarCampo);

  esquema = aplicarRegras(esquema, spec.regras, corpoRef);

  if (spec.transformacoes?.length) {
    esquema = z.preprocess(
      (valor) => aplicarTransformacoes(valor, spec.transformacoes),
      esquema
    );
  }

  if (spec.permiteNulo) esquema = esquema.nullable();

  if (!spec.obrigatorio) {
    esquema = esquema.optional();
    /* string vazia de formulário é ausência, não valor: sem isto, um campo
       opcional deixado em branco reprovaria por formato */
    esquema = z.preprocess((valor) => (valor === '' ? undefined : valor), esquema);
  } else if (spec.mensagemObrigatorio) {
    esquema = esquema.refine((valor) => valor !== undefined && valor !== '', {
      error: spec.mensagemObrigatorio,
    });
  }

  if (spec.padrao !== undefined) esquema = esquema.default(spec.padrao);

  return esquema;
}

const adaptador = {
  nome: 'zod',

  compilar(especificacao) {
    const forma = {};
    Object.entries(especificacao).forEach(([nome, campo]) => {
      forma[nome] = compilarCampo(campo.spec ?? campo);
    });

    /* campo desconhecido é descartado, não recusado: é o que neutraliza mass
       assignment (`papeis: ['admin']` no corpo simplesmente some) sem quebrar
       um front que mande um campo a mais */
    return z.object(forma).strip();
  },

  analisar(esquemaCompilado, dados) {
    corpoRef.atual = dados || {};

    const resultado = esquemaCompilado.safeParse(dados || {});

    if (resultado.success) return { sucesso: true, dados: resultado.data };
    return { sucesso: false, erros: traduzir(resultado.error) };
  },
};

module.exports = adaptador;
