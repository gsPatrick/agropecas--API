'use strict';

const { campos, esquema } = require('../../validacao');

/**
 * Esquemas de entrada.
 *
 * `valor` é `campos.livre()` de propósito — e é a escapatória mais justificada
 * do projeto: o tipo aceito depende da CHAVE, que só é conhecida depois de
 * consultar o banco. Um esquema estático não tem como saber que
 * `anuncio.max_fotos` quer número e `contato.email_suporte` quer texto.
 *
 * A validação real acontece em `configuracao.tipo.service`, contra o `tipo`
 * gravado, e devolve o mesmo 422 que este arquivo devolveria. Aqui garantimos
 * só a forma da requisição.
 */

/* a chave é identificador técnico: minúsculas, pontos e underscore. Restringir
   o formato aqui evita que uma chave com espaço ou acento chegue à consulta */
const chave = () =>
  campos
    .texto()
    .min(3)
    .max(80)
    .padraoTexto(/^[a-z0-9]+(?:[._][a-z0-9]+)*$/, 'Chave de configuração inválida.');

const identificadorChave = esquema({
  chave: chave().obrigatorio('Informe a chave da configuração.'),
});

const definir = esquema({
  valor: campos.livre().permitindoNulo(),
  motivo: campos.texto().max(300),
});

const definirVarias = esquema({
  itens: campos
    .lista(
      campos.objeto({
        chave: chave().obrigatorio('Informe a chave da configuração.'),
        valor: campos.livre().permitindoNulo(),
      })
    )
    .obrigatorio('Informe ao menos uma configuração.')
    .min(1)
    .max(50),
  motivo: campos.texto().max(300),
});

const listar = esquema({
  grupo: campos.texto().max(40),
});

const paginacao = esquema({
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
});

module.exports = { identificadorChave, definir, definirVarias, listar, paginacao };
