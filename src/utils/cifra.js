'use strict';

const crypto = require('crypto');
const db = require('../models');

/**
 * Cifra simétrica (AES-256-GCM) para credenciais guardadas no banco.
 *
 * A chave é gerada sozinha no primeiro uso e fica em `segredos_sistema`, no
 * mesmo banco — sem variável de ambiente para configurar. Isso protege a
 * credencial de quem só enxerga a coluna (log, exportação parcial, tela do
 * painel); quem tem o dump COMPLETO do banco tem a chave junto. É a troca
 * consciente por não depender de configuração no servidor.
 *
 * Formato: `v1:<iv>:<tag>:<texto>` em base64. O GCM autentica: valor
 * adulterado no banco falha na leitura em vez de virar lixo silencioso.
 */

const CHAVE = 'cripto.chave';
let memo = null;

async function chave() {
  if (memo) return memo;

  /* findOrCreate sobre a PK: dois processos subindo juntos (API e worker)
     acabam com a MESMA chave, nunca com duas */
  const [linha] = await db.SegredoSistema.findOrCreate({
    where: { chave: CHAVE },
    defaults: { valor: crypto.randomBytes(32).toString('hex') },
  });
  memo = Buffer.from(linha.valor, 'hex');
  return memo;
}

async function cifrar(texto) {
  if (texto == null || texto === '') return null;
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', await chave(), iv);
  const dados = Buffer.concat([cifra.update(String(texto), 'utf8'), cifra.final()]);
  return ['v1', iv.toString('base64'), cifra.getAuthTag().toString('base64'), dados.toString('base64')].join(':');
}

async function decifrar(valor) {
  if (!valor) return null;
  const [versao, iv, tag, dados] = String(valor).split(':');
  if (versao !== 'v1' || !iv || !tag || !dados) return null;
  try {
    const decifra = crypto.createDecipheriv('aes-256-gcm', await chave(), Buffer.from(iv, 'base64'));
    decifra.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decifra.update(Buffer.from(dados, 'base64')), decifra.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** `APP_USR-…-a1b2` → só o começo e o fim aparecem */
const mascarar = (valor) => {
  if (!valor) return null;
  const v = String(valor);
  return v.length <= 12 ? '••••' : `${v.slice(0, 8)}••••••••${v.slice(-4)}`;
};

module.exports = { cifrar, decifrar, mascarar };
