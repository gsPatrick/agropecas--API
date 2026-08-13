'use strict';

/**
 * Model → JSON da conta.
 *
 * Lista branca, como em `auth.mapper.js`: campo novo no banco não aparece na
 * API sem alguém decidir. Aqui isso pesa mais do que em outras features —
 * `usuarios` é a tabela com `senha_hash`, `ip_hash` e `observacoes_internas`.
 *
 * Três formatos, porque três públicos diferentes:
 *   · `usuario`  — o titular vendo a si mesmo;
 *   · `item`     — linha da listagem de moderação (sem dado que a tela não usa);
 *   · `ficha`    — moderador abrindo o cadastro de alguém (gera log LGPD).
 */

const papel = (registro) => ({
  chave: registro.chave,
  nome: registro.nome,
  sistema: registro.sistema,
});

const usuario = (registro) => {
  if (!registro) return null;
  return {
    id: registro.id,
    nome: registro.nome,
    email: registro.email,
    telefone: registro.telefone,
    whatsapp: registro.whatsapp,
    status: registro.status,
    idioma: registro.idioma,
    fusoHorario: registro.fuso_horario,
    emailVerificado: Boolean(registro.email_verificado_em),
    emailVerificadoEm: registro.email_verificado_em,
    ultimoLoginEm: registro.ultimo_login_em,
    anonimizadoEm: registro.anonimizado_em,
    criadoEm: registro.criado_em,
    papeis: (registro.papeis || []).map((item) => item.chave),
  };
};

const item = (registro) => ({
  id: registro.id,
  nome: registro.nome,
  email: registro.email,
  status: registro.status,
  suspensoAte: registro.suspenso_ate,
  emailVerificado: Boolean(registro.email_verificado_em),
  ultimoLoginEm: registro.ultimo_login_em,
  anonimizado: Boolean(registro.anonimizado_em),
  criadoEm: registro.criado_em,
  papeis: (registro.papeis || []).map((papelRegistro) => papelRegistro.chave),
});

/**
 * Ficha de moderação. Traz `motivoStatus` — que o titular não vê na própria
 * conta de propósito: o texto é anotação de quem moderou, e expor a redação
 * interna ao suspenso transforma cada suspensão em discussão sobre a frase.
 */
const ficha = (registro) => ({
  ...usuario(registro),
  motivoStatus: registro.motivo_status,
  suspensoAte: registro.suspenso_ate,
  totalLogins: registro.total_logins,
  excluirDefinitivamenteEm: registro.excluir_definitivamente_em,
  papeis: (registro.papeis || []).map(papel),
});

module.exports = { usuario, item, ficha, papel };
