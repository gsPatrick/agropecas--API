'use strict';

/**
 * Guarda da camada de validação.
 *
 * A abstração só vale se ninguém furar: o dia em que um service importar a
 * biblioteca direto, trocar de motor deixa de ser barato e a camada vira
 * decoração. Este script reprova o commit antes disso acontecer.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const PERMITIDO = path.join('src', 'validacao', 'adaptadores');
const BIBLIOTECAS = ['zod', 'joi', 'yup', 'ajv', 'class-validator'];

const IGNORAR = new Set(['node_modules', '.git', 'uploads', '.next']);

function* arquivos(diretorio) {
  for (const item of fs.readdirSync(diretorio, { withFileTypes: true })) {
    if (IGNORAR.has(item.name)) continue;
    const completo = path.join(diretorio, item.name);
    if (item.isDirectory()) yield* arquivos(completo);
    else if (item.name.endsWith('.js')) yield completo;
  }
}

const violacoes = [];

for (const arquivo of arquivos(RAIZ)) {
  const relativo = path.relative(RAIZ, arquivo);
  if (relativo.startsWith(PERMITIDO)) continue;

  const conteudo = fs.readFileSync(arquivo, 'utf8');

  BIBLIOTECAS.forEach((biblioteca) => {
    const importa = new RegExp(`require\\(['"\`]${biblioteca}(/[^'"\`]*)?['"\`]\\)`);
    /* comentário citando a biblioteca é documentação, não acoplamento */
    conteudo.split('\n').forEach((linha, indice) => {
      const limpa = linha.trim();
      if (limpa.startsWith('*') || limpa.startsWith('//')) return;
      if (importa.test(linha)) {
        violacoes.push({ arquivo: relativo, linha: indice + 1, biblioteca });
      }
    });
  });
}

if (violacoes.length) {
  console.error('\n❌ Biblioteca de validação importada fora de src/validacao/adaptadores:\n');
  violacoes.forEach((v) => console.error(`   ${v.arquivo}:${v.linha}  →  ${v.biblioteca}`));
  console.error('\n   Use o vocabulário do módulo:  const { campos, esquema } = require(".../validacao")\n');
  process.exit(1);
}

console.log('✅ camada de validação íntegra — nenhuma feature conhece a biblioteca');
