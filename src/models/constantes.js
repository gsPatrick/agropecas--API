'use strict';

/**
 * Enums do domínio em um lugar só. Regra: enum ESTRUTURAL (status, papel) vive
 * aqui e no banco como string legível; enum de NEGÓCIO volátil (categoria,
 * serviço, marca) vive em tabela, porque o Admin precisa gerenciar.
 */

module.exports = {
  USUARIO_STATUS: ['pendente', 'ativo', 'suspenso', 'banido', 'removido'],

  PERFIL_TIPO: ['produtor', 'loja', 'prestador', 'cliente'],
  PESSOA_TIPO: ['fisica', 'juridica'],
  DOCUMENTO_TIPO: ['cpf', 'cnpj'],

  PAPEL: ['admin', 'moderador', 'usuario'],

  ANUNCIO_TIPO: ['peca', 'servico', 'procura'],
  ANUNCIO_STATUS: ['rascunho', 'publicado', 'pausado', 'oculto', 'expirado', 'removido'],
  ANUNCIO_CONDICAO: ['nova', 'usada', 'recondicionada', 'nao_se_aplica'],
  ANUNCIO_NEGOCIACAO: ['venda', 'troca', 'venda_ou_troca', 'servico'],
  MODERACAO_STATUS: ['nao_revisado', 'aprovado', 'reprovado', 'em_analise'],

  ENDERECO_ORIGEM: ['cep', 'coordenada', 'mapa', 'municipio'],
  PRECISAO_LOCALIZACAO: ['exata', 'aproximada'],

  CONVERSA_STATUS: ['aberta', 'arquivada', 'bloqueada', 'encerrada'],
  MENSAGEM_TIPO: ['texto', 'imagem', 'arquivo', 'sistema'],

  DENUNCIA_ALVO: ['anuncio', 'perfil', 'mensagem', 'conversa'],
  DENUNCIA_STATUS: ['aberta', 'em_analise', 'procedente', 'improcedente', 'arquivada'],

  NOTIFICACAO_CANAL: ['sistema', 'email', 'whatsapp', 'push'],
  NOTIFICACAO_TIPO: [
    'mensagem_nova',
    'anuncio_aprovado',
    'anuncio_reprovado',
    'anuncio_expirando',
    'anuncio_expirado',
    'denuncia_resolvida',
    'conta_suspensa',
    'sistema',
    'contato_recebido',
    'anuncio_moderado',
    'denuncia_recebida',
    'conta_reativada',
    'documento_atualizado',
  ],

  TOKEN_TIPO: [
    'verificacao_email',
    'recuperacao_senha',
    'otp_login',
    'verificacao_telefone',
    /* confirmação de operação irreversível: reusar `otp_login` aqui invalidava
       um código de login pendente do mesmo usuário */
    'confirmacao_exportacao',
    'confirmacao_exclusao',
  ],

  CONSENTIMENTO_TIPO: [
    'termos_de_uso',
    'politica_privacidade',
    'exibir_whatsapp',
    'exibir_endereco_exato',
    'comunicacao_marketing',
    'cookies_analiticos',
  ],

  DOCUMENTO_LEGAL_TIPO: ['termos_de_uso', 'politica_privacidade', 'politica_cookies'],

  TITULAR_SOLICITACAO_TIPO: [
    'acesso',
    'correcao',
    'exclusao',
    'portabilidade',
    'revogacao_consentimento',
    'anonimizacao',
    'oposicao',
  ],
  TITULAR_SOLICITACAO_STATUS: ['aberta', 'em_atendimento', 'concluida', 'recusada'],

  ASSINATURA_STATUS: ['ativa', 'cancelada', 'expirada', 'inadimplente', 'periodo_teste'],
  PLANO_PERIODICIDADE: ['mensal', 'trimestral', 'anual', 'vitalicio'],

  AUDITORIA_ACAO: [
    'criar',
    'editar',
    'remover',
    'restaurar',
    'ocultar',
    'publicar',
    'aprovar',
    'reprovar',
    'suspender',
    'banir',
    'login',
    'logout',
    'exportar_dados',
    'acessar_dado_pessoal',

    /* acrescentados quando as features precisaram: gravar um verbo fora
       desta lista faz o INSERT falhar, e a auditoria engole a falha — a ação
       acontecia e o rastro sumia */
    'anonimizar',
    'consultar',
    'configurar',
    'enviar_comunicado',
    'moderar',
  ],
};
