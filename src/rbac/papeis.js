'use strict';

const { CORINGA, CHAVES, doRecurso, propriasDoRecurso } = require('./permissoes');

/**
 * Papéis padrão do sistema.
 *
 * ADMIN recebe o CORINGA `*` — e isso é decisão de produto, não atalho de
 * implementação. A cliente pediu flexibilidade total (Maturacao/05, §2.4): ele
 * cria, edita, apaga, publica em nome de terceiro, permite e nega qualquer
 * coisa. O fluxo padrão do sistema é o dela; o Admin pode intervir em qualquer
 * ponto desse fluxo quando quiser.
 *
 * O preço disso é rastro: toda ação de Admin grava em `logs_auditoria` e toda
 * LEITURA de dado pessoal de terceiro grava em `logs_acesso_dado`. Poder amplo
 * sem registro é o que transforma flexibilidade em risco.
 *
 * `sistema: true` marca papel que o próprio Admin não pode apagar — sem isso
 * dá para remover o papel de admin e ficar sem ninguém no controle.
 */

const PAPEIS = [
  {
    chave: 'admin',
    nome: 'Administrador',
    descricao:
      'Controle total da plataforma. Faz tudo o que qualquer perfil faz, sobre o registro de qualquer usuário, e pode intervir em qualquer fluxo.',
    sistema: true,
    permissoes: [CORINGA],
  },

  {
    chave: 'moderador',
    nome: 'Moderador',
    descricao:
      'Cuida de conteúdo e denúncias. Não mexe em configuração, plano nem papel de outro usuário.',
    sistema: true,
    permissoes: [
      'admin.acessar',
      ...doRecurso('denuncia'),
      'anuncio.ler.todos',
      'anuncio.editar.todos',
      'anuncio.ocultar.todos',
      'anuncio.aprovar.todos',
      'anuncio.reprovar.todos',
      'anuncio_foto.bloquear.todos',
      'anuncio_foto.remover.todos',
      'perfil.ler.todos',
      'usuario.ler.todos',
      'usuario.suspender.todos',
      /* lê conversa apenas para apurar denúncia — cada abertura vira registro
         em logs_acesso_dado */
      'conversa.ler.todas',
      'conversa.bloquear.todas',
      'mensagem.remover.todas',
      'bloqueio.ler.todos',
      'auditoria.ler.todos',
      'lgpd.acessar_dado_pessoal.todos',
    ],
  },

  {
    chave: 'suporte',
    nome: 'Suporte',
    descricao:
      'Atende o usuário: consulta cadastro, responde solicitação de LGPD e acompanha anúncios. Não remove nem bane.',
    sistema: true,
    permissoes: [
      'admin.acessar',
      'usuario.ler.todos',
      'perfil.ler.todos',
      'anuncio.ler.todos',
      'anuncio.ver_metricas.todos',
      'denuncia.ler.todas',
      'lgpd.ler_solicitacoes.todas',
      'lgpd.responder_solicitacao.todas',
      'lgpd.acessar_dado_pessoal.todos',
      'relatorio.ler.todos',
      'auditoria.ler.todos',
      'notificacao.enviar.todas',
    ],
  },

  {
    chave: 'usuario',
    nome: 'Usuário',
    descricao:
      'Papel de todo cadastro: produtor, loja ou prestador. Age sobre o que é seu. O que diferencia os três é o PERFIL, não a permissão.',
    sistema: true,
    permissoes: [
      ...propriasDoRecurso('usuario'),
      ...propriasDoRecurso('perfil'),
      ...propriasDoRecurso('anuncio'),
      ...propriasDoRecurso('anuncio_foto'),
      ...propriasDoRecurso('favorito'),
      ...propriasDoRecurso('conversa'),
      ...propriasDoRecurso('mensagem'),
      ...propriasDoRecurso('denuncia'),
      ...propriasDoRecurso('bloqueio'),
      ...propriasDoRecurso('notificacao'),
      ...propriasDoRecurso('lgpd'),
      ...propriasDoRecurso('arquivo'),
      'plano.ler',
    ],
  },
];

/** valida que nenhum papel referencia permissão inexistente */
function validar() {
  const problemas = [];

  PAPEIS.forEach((papel) => {
    papel.permissoes.forEach((chave) => {
      if (chave !== CORINGA && !CHAVES.includes(chave)) {
        problemas.push(`Papel "${papel.chave}" referencia permissão inexistente: ${chave}`);
      }
    });
  });

  return problemas;
}

module.exports = { PAPEIS, validar };
