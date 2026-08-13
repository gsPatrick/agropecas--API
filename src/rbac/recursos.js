'use strict';

/**
 * `administrativa: true` marca ação SEM escopo que mesmo assim é privativa de
 * quem administra. A distinção importa porque `propriasDoRecurso()` entrega ao
 * papel `usuario` tudo que não é `.todos` — o que está certo para
 * `anuncio.criar` (todo mundo publica) e seria desastroso para
 * `lgpd.publicar_documento` (publicar Termos de Uso novos).
 *
 * Sem essa marca, ação administrativa sem escopo vaza para todo cadastro.
 */

/**
 * Recursos e ações do sistema — a fonte de verdade do RBAC.
 *
 * Cada permissão nasce daqui no formato `recurso.acao` ou `recurso.acao.escopo`.
 * Escopo responde "sobre QUAIS registros": `proprio` (os meus) ou `todos`
 * (os de qualquer um). Capacidade sem escopo é ação que não incide sobre
 * registro de terceiro (ex.: `anuncio.criar`).
 *
 * Adicionar funcionalidade ao sistema = adicionar ação aqui. Nunca escrever
 * a string da permissão solta no código de uma feature.
 */

const RECURSOS = {
  // ─── IDENTIDADE ────────────────────────────────────────────
  usuario: {
    rotulo: 'Usuários',
    acoes: {
      ler: { escopos: ['proprio', 'todos'], descricao: 'Ver dados cadastrais' },
      editar: { escopos: ['proprio', 'todos'], descricao: 'Alterar dados cadastrais' },
      criar: {
        escopos: [],
        administrativa: true,
        descricao: 'Criar usuário manualmente (Admin)',
      },
      remover: { escopos: ['proprio', 'todos'], descricao: 'Excluir conta (anonimização)' },
      suspender: { escopos: ['todos'], descricao: 'Suspender temporariamente' },
      banir: { escopos: ['todos'], descricao: 'Banir definitivamente' },
      restaurar: { escopos: ['todos'], descricao: 'Reativar conta suspensa ou removida' },
      trocar_senha: { escopos: ['proprio', 'todos'], descricao: 'Definir nova senha' },
      encerrar_sessoes: { escopos: ['proprio', 'todos'], descricao: 'Derrubar sessões ativas' },
      exportar_dados: { escopos: ['proprio', 'todos'], descricao: 'Exportar dados do titular (LGPD)' },
      anonimizar: { escopos: ['todos'], descricao: 'Anonimizar dados pessoais (LGPD)' },
    },
  },

  perfil: {
    rotulo: 'Perfis',
    acoes: {
      ler: { escopos: ['proprio', 'todos'], descricao: 'Ver perfil, inclusive campos privados' },
      editar: { escopos: ['proprio', 'todos'], descricao: 'Alterar perfil' },
      verificar: { escopos: ['todos'], descricao: 'Marcar cadastro como verificado' },
      remover: { escopos: ['proprio', 'todos'], descricao: 'Remover perfil' },
    },
  },

  // ─── ANÚNCIOS ──────────────────────────────────────────────
  anuncio: {
    rotulo: 'Anúncios',
    acoes: {
      criar: { escopos: [], descricao: 'Publicar anúncio' },
      criar_em_nome_de: {
        escopos: ['todos'],
        descricao: 'Publicar em nome de outro usuário (poder de intervenção do Admin)',
      },
      ler: { escopos: ['proprio', 'todos'], descricao: 'Ver anúncio, inclusive rascunho e oculto' },
      editar: { escopos: ['proprio', 'todos'], descricao: 'Alterar anúncio' },
      remover: { escopos: ['proprio', 'todos'], descricao: 'Excluir anúncio' },
      publicar: { escopos: ['proprio', 'todos'], descricao: 'Tirar do rascunho' },
      pausar: { escopos: ['proprio', 'todos'], descricao: 'Pausar sem excluir' },
      renovar: { escopos: ['proprio', 'todos'], descricao: 'Estender a validade' },
      ocultar: { escopos: ['todos'], descricao: 'Tirar do ar por moderação' },
      aprovar: { escopos: ['todos'], descricao: 'Aprovar na moderação' },
      reprovar: { escopos: ['todos'], descricao: 'Reprovar na moderação' },
      destacar: { escopos: ['todos'], descricao: 'Colocar em destaque' },
      ver_metricas: { escopos: ['proprio', 'todos'], descricao: 'Ver visualizações e contatos' },
      ver_contatos: { escopos: ['proprio', 'todos'], descricao: 'Ver quem entrou em contato' },
    },
  },

  anuncio_foto: {
    rotulo: 'Fotos de anúncio',
    acoes: {
      enviar: { escopos: ['proprio', 'todos'], descricao: 'Subir imagem' },
      remover: { escopos: ['proprio', 'todos'], descricao: 'Excluir imagem' },
      bloquear: { escopos: ['todos'], descricao: 'Bloquear imagem imprópria sem apagar o anúncio' },
    },
  },

  favorito: {
    rotulo: 'Favoritos',
    acoes: {
      gerenciar: { escopos: ['proprio'], descricao: 'Salvar e remover favoritos' },
      ler: { escopos: ['proprio', 'todos'], descricao: 'Ver lista de favoritos' },
    },
  },

  // ─── CONVERSAS ─────────────────────────────────────────────
  conversa: {
    rotulo: 'Conversas',
    acoes: {
      criar: { escopos: [], descricao: 'Iniciar conversa a partir de um anúncio' },
      ler: {
        escopos: ['propria', 'todas'],
        descricao: 'Abrir conversa — `todas` registra acesso a dado pessoal (LGPD)',
      },
      responder: { escopos: ['propria', 'todas'], descricao: 'Enviar mensagem' },
      arquivar: { escopos: ['propria'], descricao: 'Arquivar da caixa de entrada' },
      encerrar: { escopos: ['propria', 'todas'], descricao: 'Encerrar conversa' },
      bloquear: { escopos: ['todas'], descricao: 'Bloquear conversa por abuso' },
    },
  },

  mensagem: {
    rotulo: 'Mensagens',
    acoes: {
      remover: { escopos: ['propria', 'todas'], descricao: 'Apagar mensagem (conteúdo, não o registro)' },
    },
  },

  // ─── MODERAÇÃO ─────────────────────────────────────────────
  denuncia: {
    rotulo: 'Denúncias',
    acoes: {
      criar: { escopos: [], descricao: 'Denunciar anúncio, perfil ou mensagem' },
      ler: { escopos: ['propria', 'todas'], descricao: 'Ver denúncias' },
      resolver: { escopos: ['todas'], descricao: 'Julgar e registrar a ação tomada' },
    },
  },

  bloqueio: {
    rotulo: 'Bloqueio entre usuários',
    acoes: {
      gerenciar: { escopos: ['proprio'], descricao: 'Bloquear e desbloquear outro usuário' },
      ler: { escopos: ['todos'], descricao: 'Ver bloqueios de qualquer usuário' },
    },
  },

  // ─── CATÁLOGO (gerenciado pelo Admin) ──────────────────────
  categoria: {
    rotulo: 'Categorias',
    acoes: {
      criar: { escopos: [], descricao: 'Criar categoria' },
      editar: { escopos: [], descricao: 'Alterar categoria' },
      remover: { escopos: [], descricao: 'Remover categoria' },
      ordenar: { escopos: [], descricao: 'Reordenar e definir destaques' },
    },
  },

  marca: {
    rotulo: 'Marcas',
    acoes: {
      criar: { escopos: [], descricao: 'Criar marca' },
      editar: { escopos: [], descricao: 'Alterar marca' },
      remover: { escopos: [], descricao: 'Remover marca' },
    },
  },

  maquina: {
    rotulo: 'Máquinas',
    acoes: {
      criar: { escopos: [], descricao: 'Criar modelo de máquina' },
      editar: { escopos: [], descricao: 'Alterar modelo' },
      remover: { escopos: [], descricao: 'Remover modelo' },
    },
  },

  servico: {
    rotulo: 'Serviços',
    acoes: {
      criar: { escopos: [], administrativa: true, descricao: 'Criar serviço do catálogo' },
      editar: { escopos: [], administrativa: true, descricao: 'Alterar serviço' },
      remover: { escopos: [], administrativa: true, descricao: 'Remover serviço' },
      ordenar: { escopos: [], administrativa: true, descricao: 'Reordenar serviços do catálogo' },
    },
  },

  // ─── AVISOS ────────────────────────────────────────────────
  notificacao: {
    rotulo: 'Notificações',
    acoes: {
      ler: { escopos: ['propria', 'todas'], descricao: 'Ver notificações' },
      marcar_lida: { escopos: ['propria'], descricao: 'Marcar como lida' },
      preferencias: { escopos: ['propria', 'todas'], descricao: 'Alterar preferências de canal' },
      enviar: { escopos: ['todas'], descricao: 'Disparar aviso para usuários (comunicado)' },
      template_editar: {
        escopos: [],
        administrativa: true,
        descricao: 'Editar o texto dos avisos',
      },
    },
  },

  // ─── PAINEL ADMINISTRATIVO ─────────────────────────────────
  /**
   * O painel não cria poder novo: quem entra nele continua limitado às
   * permissões que já tem. `acessar` é a porta; cada tela lá dentro exige a
   * permissão do recurso que ela manipula.
   *
   * Existir como recurso próprio permite dar acesso ao painel a um moderador
   * sem lhe dar o coringa do Admin — antes, `somenteAdmin` apontava para uma
   * permissão inexistente e só passava quem tinha `*`.
   */
  admin: {
    rotulo: 'Painel administrativo',
    acoes: {
      acessar: { escopos: [], administrativa: true, descricao: 'Entrar no painel administrativo' },
      agir_em_nome_de: {
        escopos: [],
        administrativa: true,
        descricao: 'Executar ação representando outro usuário (registrado na auditoria)',
      },
      operar_em_lote: {
        escopos: [],
        administrativa: true,
        descricao: 'Aplicar ação a vários registros de uma vez',
      },
    },
  },

  // ─── LGPD ──────────────────────────────────────────────────
  lgpd: {
    rotulo: 'LGPD',
    acoes: {
      solicitar: { escopos: ['proprio'], descricao: 'Abrir solicitação de titular' },
      ler_solicitacoes: { escopos: ['propria', 'todas'], descricao: 'Ver solicitações' },
      responder_solicitacao: { escopos: ['todas'], descricao: 'Responder solicitação do titular' },
      acessar_dado_pessoal: {
        escopos: ['todos'],
        descricao: 'Abrir dado pessoal de terceiro — toda leitura gera log',
      },
      publicar_documento: {
        escopos: [],
        administrativa: true,
        descricao: 'Publicar nova versão de Termos/Política',
      },
    },
  },

  auditoria: {
    rotulo: 'Auditoria',
    acoes: {
      ler: { escopos: ['todos'], descricao: 'Consultar trilha de auditoria' },
      exportar: { escopos: ['todos'], descricao: 'Exportar trilha' },
    },
  },

  // ─── PLATAFORMA ────────────────────────────────────────────
  relatorio: {
    rotulo: 'Relatórios',
    acoes: {
      ler: { escopos: ['todos'], descricao: 'Painel de números da plataforma' },
      busca: { escopos: ['todos'], descricao: 'Termos buscados e buscas sem resultado' },
      exportar: { escopos: ['todos'], descricao: 'Exportar relatório' },
    },
  },

  configuracao: {
    rotulo: 'Configurações',
    acoes: {
      ler: { escopos: [], descricao: 'Ver configurações do sistema' },
      editar: { escopos: [], descricao: 'Alterar configurações do sistema' },
    },
  },

  plano: {
    rotulo: 'Planos e assinaturas',
    acoes: {
      ler: { escopos: [], descricao: 'Ver planos' },
      criar: { escopos: [], descricao: 'Criar plano' },
      editar: { escopos: [], descricao: 'Alterar plano e limites' },
      remover: { escopos: [], descricao: 'Remover plano' },
      atribuir: { escopos: ['todos'], descricao: 'Trocar o plano de um usuário' },
    },
  },

  rbac: {
    rotulo: 'Papéis e permissões',
    acoes: {
      ler: { escopos: [], descricao: 'Ver papéis e permissões' },
      criar_papel: { escopos: [], descricao: 'Criar papel' },
      editar_papel: { escopos: [], descricao: 'Alterar papel e suas permissões' },
      remover_papel: { escopos: [], descricao: 'Remover papel' },
      atribuir_papel: { escopos: ['todos'], descricao: 'Dar ou tirar papel de um usuário' },
    },
  },

  arquivo: {
    rotulo: 'Arquivos',
    acoes: {
      enviar: { escopos: ['proprio'], descricao: 'Subir arquivo' },
      remover: { escopos: ['proprio', 'todos'], descricao: 'Remover arquivo' },
    },
  },
};

module.exports = { RECURSOS };
