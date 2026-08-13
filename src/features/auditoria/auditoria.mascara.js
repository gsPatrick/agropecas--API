'use strict';

/**
 * Mascaramento de `antes`/`depois` antes de gravar na trilha.
 *
 * A trilha é lida por Admin e por moderador, é exportada, e vive cinco anos
 * (ver `documentacao/models/LGPD.md` §4). Se o diff de uma edição de perfil
 * gravar o CPF em claro, o CPF passa a existir num segundo lugar — com prazo
 * mais longo e com mais gente autorizada a ler — sem que ninguém tenha
 * decidido isso. Auditoria precisa provar QUE o campo mudou, não repetir o
 * valor dele.
 *
 * O que fica: nome do campo, tipo da mudança e um resumo irreversível
 * (`***1234`) que permite conferir "é o mesmo valor de antes?" sem expor o
 * dado. O valor íntegro continua na tabela de origem, que é onde ele deve
 * estar.
 */

/** nomes de campo cujo VALOR nunca entra na trilha */
const SEGREDOS = /senha|password|token|codigo|secret|chave_privada|authorization/i;

/** dado pessoal: entra mascarado, porque saber que mudou ainda importa */
const PESSOAIS =
  /documento|cpf|cnpj|email|telefone|whatsapp|celular|endereco|logradouro|latitude|longitude|cep|ip_hash|ip\b|conteudo|mensagem|bio|razao_social|nome_completo|inscricao/i;

const PROFUNDIDADE_MAXIMA = 6;

/** `***` preservando as últimas posições — o bastante para comparar, não para usar */
function resumir(valor) {
  const texto = String(valor);
  if (texto.length <= 4) return '***';
  return `***${texto.slice(-4)}`;
}

function mascararValor(chave, valor, profundidade) {
  if (valor === null || valor === undefined) return valor;

  if (SEGREDOS.test(chave)) return '[oculto]';

  if (typeof valor === 'object') return percorrer(valor, profundidade + 1);

  if (PESSOAIS.test(chave)) return resumir(valor);

  /* texto muito longo não é diff, é cópia de conteúdo: corta */
  if (typeof valor === 'string' && valor.length > 300) return `${valor.slice(0, 300)}…[cortado]`;

  return valor;
}

function percorrer(entrada, profundidade = 0) {
  if (entrada === null || entrada === undefined) return entrada;
  if (profundidade > PROFUNDIDADE_MAXIMA) return '[profundo demais]';

  if (Array.isArray(entrada)) {
    /* lista longa em log é quase sempre engano de quem chamou; 50 já conta a
       história e evita um JSONB de megabytes por linha */
    return entrada.slice(0, 50).map((item) => percorrer(item, profundidade + 1));
  }

  if (typeof entrada !== 'object') return entrada;

  /* instância do Sequelize entra por engano com frequência — `get()` traz os
     valores, sem os metadados do model */
  const simples = typeof entrada.get === 'function' ? entrada.get({ plain: true }) : entrada;

  const saida = {};
  Object.entries(simples).forEach(([chave, valor]) => {
    saida[chave] = mascararValor(chave, valor, profundidade);
  });
  return saida;
}

/** ponto de entrada: recebe o que a feature mandou, devolve o que pode ser gravado */
const mascarar = (objeto) => (objeto === null || objeto === undefined ? null : percorrer(objeto, 0));

module.exports = { mascarar, resumir, SEGREDOS, PESSOAIS };
