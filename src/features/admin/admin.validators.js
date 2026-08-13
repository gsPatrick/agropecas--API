'use strict';

const { campos, esquema } = require('../../validacao');

const {
  USUARIO_STATUS,
  PERFIL_TIPO,
  ANUNCIO_TIPO,
  ANUNCIO_STATUS,
  ANUNCIO_CONDICAO,
  ANUNCIO_NEGOCIACAO,
  MODERACAO_STATUS,
  CONVERSA_STATUS,
  DENUNCIA_ALVO,
  DENUNCIA_STATUS,
  NOTIFICACAO_TIPO,
  NOTIFICACAO_CANAL,
  DOCUMENTO_LEGAL_TIPO,
  TITULAR_SOLICITACAO_TIPO,
  TITULAR_SOLICITACAO_STATUS,
  PLANO_PERIODICIDADE,
  AUDITORIA_ACAO,
} = require('../../models/constantes');

const { MOTIVOS: DENUNCIA_MOTIVOS, STATUS_RESOLVIDOS, ACOES_TOMADAS } = require('../denuncia/denuncia.constants');
const { FILA_STATUS, MOTIVO_MINIMO, SUSPENSAO } = require('../moderacao/moderacao.constants');
const { STATUS_FINAIS } = require('../lgpd/lgpd.constants');
const { CATEGORIA_TIPO, MARCA_TIPO, MAQUINA_CATEGORIA } = require('../catalogo/catalogo.constants');
const { PAGINACAO } = require('./helpers/admin.consulta.helper');

/**
 * Esquemas de entrada do painel administrativo.
 *
 * Este arquivo é o contrato de `admin.routes.js`: cada `esquemas.x` citado lá
 * existe aqui, com o mesmo nome. Compilados UMA vez, no carregamento do
 * módulo — a rota referencia o objeto já pronto.
 *
 * Três regras atravessam o arquivo inteiro e valem mais que qualquer campo
 * isolado:
 *
 * 1. **Vocabulário vem dos enums dos models.** Escrever a lista de status à
 *    mão faria a API aceitar um valor que o banco recusa, e o 422 viraria 500
 *    no INSERT.
 *
 * 2. **Motivo é obrigatório em toda ação punitiva ou invasiva**, com mínimo de
 *    caracteres. Motivo vazio é o mesmo que não ter motivo: a linha da
 *    auditoria existe, mas não responde a pergunta que ela deveria responder
 *    quando alguém recorre da suspensão seis meses depois. `MOTIVO_MINIMO`
 *    vem de `moderacao.constants` para que os dois módulos exijam o mesmo.
 *
 * 3. **Todo lote tem teto.** Um `ids` sem `max` transforma um clique errado em
 *    incidente sobre a base inteira, e não existe desfazer. O teto aqui espelha
 *    o de `helpers/admin.contexto.helper.js` (`garantirLote`) — a validação
 *    recusa antes, o helper recusa de novo, e nenhuma das duas confia na outra.
 */

// ─── PEÇAS REUTILIZADAS ─────────────────────────────────────────

/** teto de ids por operação em lote — o mesmo de `garantirLote` */
const LOTE_MAXIMO = 100;

/** coleções gerenciáveis do catálogo, como aparecem na URL */
const COLECOES = ['categorias', 'marcas', 'maquinas', 'servicos'];

/** ações de sanção aceitas no lote de usuários */
const ACOES_SANCAO = ['suspender', 'banir', 'restaurar'];

/** ações aceitas no lote de moderação de anúncios */
const ACOES_MODERACAO = ['aprovar', 'reprovar', 'ocultar', 'remover'];

const FORMATOS_EXPORTACAO = ['json', 'csv'];

const uuid = () => campos.uuid();
const uuidObrigatorio = (mensagem) => campos.uuid().obrigatorio(mensagem || 'Identificador inválido.');

/**
 * Motivo de ação administrativa.
 *
 * Sempre com piso: "ok", "." ou " " como justificativa de banimento deixam a
 * trilha formalmente completa e materialmente inútil.
 */
const motivoTexto = (mensagem = 'Informe o motivo.') =>
  campos
    .textoLongo()
    .obrigatorio(mensagem)
    .min(MOTIVO_MINIMO, `O motivo precisa de ao menos ${MOTIVO_MINIMO} caracteres.`)
    .max(1000);

/** lista de ids com teto — nunca declare `campos.lista(uuid())` sem `.max()` */
const lote = (mensagem = 'Informe os registros.') =>
  campos
    .lista(uuid())
    .obrigatorio(mensagem)
    .min(1, 'Informe ao menos um registro.')
    .max(LOTE_MAXIMO, `Máximo de ${LOTE_MAXIMO} registros por operação.`);

/**
 * Recorte por data. Fica solto (não obrigatório) porque a fila de moderação
 * quer "tudo que está pendente" e o relatório quer um mês fechado — quem exige
 * período é o service, via `lerPeriodo`, que também aplica o teto de dias.
 */
const recorteDeData = {
  de: campos.data(),
  ate: campos.data(),
};

/**
 * Campos comuns a TODA listagem do painel.
 *
 * `ordenarPor` é texto livre no esquema e lista branca no service
 * (`lerFiltros` só aceita colunas declaradas): fechar o enum aqui exigiria um
 * esquema por tela, e o risco real — coluna arbitrária no `ORDER BY` — já é
 * neutralizado lá.
 */
const listagemBase = {
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(PAGINACAO.maximo),
  busca: campos.texto().max(120),
  ...recorteDeData,
  ordenarPor: campos.texto().max(40),
  direcao: campos.umDe(['asc', 'desc', 'ASC', 'DESC']),
};

// ─── GERAIS ─────────────────────────────────────────────────────

const periodo = esquema({
  ...recorteDeData,
  granularidade: campos.umDe(['dia', 'semana', 'mes']).padrao('dia'),
});

const listagem = esquema({ ...listagemBase });

const identificador = esquema({ id: uuidObrigatorio() });

/**
 * `DELETE /usuarios/:id/papeis/:papel`.
 *
 * `papel` é texto e não `umDe(PAPEL)` de propósito: o painel cria papéis novos
 * (`rbac.criar_papel`), e fechar o enum aqui faria a remoção de um papel
 * customizado responder 422 sobre um papel que existe de verdade.
 */
const identificadorPapel = esquema({
  id: uuidObrigatorio(),
  papel: campos
    .texto()
    .obrigatorio('Informe o papel.')
    .max(40)
    .minusculo()
    .padraoTexto(/^[a-z0-9_]+$/, 'Papel inválido.'),
});

// ─── USUÁRIOS ───────────────────────────────────────────────────

const listarUsuarios = esquema({
  ...listagemBase,
  status: campos.umDe(USUARIO_STATUS),
  papel: campos.texto().max(40).minusculo(),
  tipoPerfil: campos.umDe(PERFIL_TIPO).rotulo('tipo de perfil'),
  verificado: campos.booleano(),
  uf: campos.texto().min(2).max(2),
  cidade: campos.texto().max(120),
  comDenuncias: campos.booleano(),
});

/**
 * Edição de cadastro alheio pelo Admin.
 *
 * `status` NÃO entra aqui: mudar status é suspender/banir/restaurar, com
 * permissão própria e motivo obrigatório. Aceitar `status` num PATCH genérico
 * seria abrir um caminho para banir alguém sem passar por `usuario.banir` —
 * exatamente o atalho que a separação de rotas existe para fechar.
 */
const editarUsuario = esquema({
  nome: campos.texto().min(2).max(160),
  email: campos.email(),
  telefone: campos.telefone().comoE164(),
  whatsapp: campos.telefone().comoE164(),
  observacaoInterna: campos.textoLongo().max(2000),
  motivo: campos.texto().max(300),
});

/**
 * Suspensão e banimento.
 *
 * `dias` só faz sentido na suspensão; banimento é indeterminado e o service
 * ignora o campo. Teto de `SUSPENSAO.DIAS_MAXIMO` porque "suspenso por 9999
 * dias" é banimento disfarçado, sem passar por `usuario.banir`.
 */
const sancao = esquema({
  motivo: motivoTexto('Descreva o motivo da sanção.'),
  dias: campos.inteiro().min(1).max(SUSPENSAO.DIAS_MAXIMO),
  notificar: campos.booleano().padrao(true),
  encerrarSessoes: campos.booleano().padrao(true),
  denunciaId: uuid(),
});

const motivo = esquema({ motivo: motivoTexto() });

/** aprovação não precisa de justificativa — recusar precisa */
const motivoOpcional = esquema({ motivo: campos.textoLongo().max(1000) });

const papel = esquema({
  papel: campos
    .texto()
    .obrigatorio('Informe o papel a atribuir.')
    .max(40)
    .minusculo()
    .padraoTexto(/^[a-z0-9_]+$/, 'Papel inválido.'),
  motivo: campos.texto().max(300),
  expiraEm: campos.data(),
});

const loteSancao = esquema({
  ids: lote('Informe os usuários.'),
  acao: campos.umDe(ACOES_SANCAO).obrigatorio('Informe a sanção a aplicar.'),
  motivo: motivoTexto('Descreva o motivo da sanção em lote.'),
  dias: campos.inteiro().min(1).max(SUSPENSAO.DIAS_MAXIMO),
  notificar: campos.booleano().padrao(true),
});

// ─── PERFIS ─────────────────────────────────────────────────────

const listarPerfis = esquema({
  ...listagemBase,
  tipo: campos.umDe(PERFIL_TIPO).rotulo('tipo de perfil'),
  verificado: campos.booleano(),
  uf: campos.texto().min(2).max(2),
  cidade: campos.texto().max(120),
});

/**
 * Verificar perfil é o selo que a plataforma põe no nome de alguém — e é o que
 * o produtor usa para decidir se confia. Exigir o que foi conferido evita que
 * o selo vire favor.
 */
const verificacao = esquema({
  observacao: campos.textoLongo().max(1000),
  documentoConferido: campos.booleano().padrao(false),
  validoAte: campos.data(),
});

// ─── CONTEÚDO ───────────────────────────────────────────────────

const listarAnuncios = esquema({
  ...listagemBase,
  status: campos.umDe(ANUNCIO_STATUS),
  tipo: campos.umDe(ANUNCIO_TIPO).rotulo('tipo de anúncio'),
  moderacaoStatus: campos.umDe(MODERACAO_STATUS).rotulo('situação de moderação'),
  usuarioId: uuid(),
  categoriaId: uuid(),
  marcaId: uuid(),
  destaque: campos.booleano(),
  comDenuncias: campos.booleano(),
});

/** editar anúncio alheio exige motivo: é intervenção, não manutenção */
const editarAnuncio = esquema({
  titulo: campos.texto().min(5).max(160),
  descricao: campos.textoLongo().max(8000),
  precoCentavos: campos.inteiro().min(0).permitindoNulo(),
  categoriaId: uuid(),
  condicao: campos.umDe(ANUNCIO_CONDICAO),
  negociacao: campos.umDe(ANUNCIO_NEGOCIACAO),
  motivo: motivoTexto('Descreva por que está editando este anúncio.'),
});

const filaModeracao = esquema({
  ...listagemBase,
  moderacaoStatus: campos.umDe(FILA_STATUS).rotulo('situação na fila'),
  tipo: campos.umDe(ANUNCIO_TIPO).rotulo('tipo de anúncio'),
  comDenuncias: campos.booleano(),
});

const destaque = esquema({
  destacar: campos.booleano().obrigatorio('Informe se destaca ou remove o destaque.'),
  ateEm: campos.data(),
  motivo: campos.texto().max(300),
});

/**
 * Publicar em nome do anunciante.
 *
 * `usuarioId` é o representado; o autor da ação continua sendo o Admin (ver
 * `helpers/admin.contexto.helper.js`). O motivo é obrigatório porque criar
 * conteúdo no nome de outra pessoa precisa de justificativa registrada — é o
 * caso em que a auditoria mais é consultada depois.
 */
const anuncioEmNomeDe = esquema({
  usuarioId: uuidObrigatorio('Informe em nome de quem o anúncio será criado.'),
  motivo: motivoTexto('Descreva por que está publicando em nome deste usuário.'),
  anuncio: campos
    .objeto({
      tipo: campos.umDe(ANUNCIO_TIPO).obrigatorio('Informe o tipo do anúncio.'),
      titulo: campos.texto().obrigatorio('Informe o título.').min(5).max(160),
      descricao: campos.textoLongo().max(8000),
      categoriaId: uuid(),
      marcaId: uuid(),
      maquinaId: uuid(),
      precoCentavos: campos.inteiro().min(0).permitindoNulo(),
      condicao: campos.umDe(ANUNCIO_CONDICAO),
      negociacao: campos.umDe(ANUNCIO_NEGOCIACAO),
      quantidade: campos.inteiro().min(1).max(100000),
      municipioId: uuid(),
      publicar: campos.booleano().padrao(false),
    })
    .obrigatorio('Informe os dados do anúncio.'),
});

const loteModeracao = esquema({
  ids: lote('Informe os anúncios.'),
  acao: campos.umDe(ACOES_MODERACAO).obrigatorio('Informe a ação de moderação.'),
  /* reprovar/ocultar/remover em massa sem motivo deixa dezenas de anunciantes
     sem explicação e a moderação sem defesa; aprovar em massa também é decisão */
  motivo: motivoTexto('Descreva o motivo da moderação em lote.'),
  notificar: campos.booleano().padrao(true),
});

// ─── CATÁLOGO ───────────────────────────────────────────────────

const colecao = esquema({
  colecao: campos.umDe(COLECOES).obrigatorio('Coleção de catálogo inválida.').rotulo('coleção'),
});

const colecaoItem = esquema({
  colecao: campos.umDe(COLECOES).obrigatorio('Coleção de catálogo inválida.').rotulo('coleção'),
  id: uuidObrigatorio(),
});

/**
 * Item de catálogo — um esquema para quatro coleções.
 *
 * A união dos campos é intencional: a rota é `/catalogo/:colecao` e o esquema é
 * escolhido antes de saber a coleção. Campo que não pertence à coleção é
 * descartado pelo service (que delega ao `catalogo.*.service` correspondente,
 * com o esquema estrito da feature). Aqui garantimos formato e teto de
 * tamanho — não a pertinência.
 */
const itemCatalogo = esquema({
  nome: campos.texto().min(2).max(120),
  modelo: campos.texto().min(2).max(120),
  slug: campos.texto().max(160),
  descricao: campos.textoLongo().max(2000),
  parentId: uuid().permitindoNulo(),
  categoriaId: uuid().permitindoNulo(),
  marcaId: uuid(),
  tipo: campos.umDe([...new Set([...CATEGORIA_TIPO, ...MARCA_TIPO])]),
  categoriaMaquina: campos.umDe(MAQUINA_CATEGORIA).rotulo('categoria de máquina'),
  anoInicio: campos.inteiro().min(1950).max(new Date().getFullYear() + 2),
  anoFim: campos.inteiro().min(1950).max(new Date().getFullYear() + 2),
  potenciaCv: campos.inteiro().min(0).max(3000),
  icone: campos.texto().max(40),
  imagemUrl: campos.texto().max(500),
  logoUrl: campos.texto().max(500),
  observacao: campos.textoLongo().max(2000),
  ordem: campos.inteiro().min(0).max(100000),
  destaque: campos.booleano(),
  ativo: campos.booleano(),
  seoTitulo: campos.texto().max(180),
  seoDescricao: campos.texto().max(300),
  regerarSlug: campos.booleano(),
});

const ordenacao = esquema({
  itens: campos
    .lista(
      campos.objeto({
        id: uuidObrigatorio(),
        ordem: campos.inteiro().min(0).max(100000).obrigatorio('Informe a ordem.'),
        destaque: campos.booleano(),
      })
    )
    .obrigatorio('Informe a nova ordem.')
    .min(1)
    .max(500),
});

// ─── COMUNIDADE ─────────────────────────────────────────────────

const listarDenuncias = esquema({
  ...listagemBase,
  status: campos.umDe(DENUNCIA_STATUS),
  alvoTipo: campos.umDe(DENUNCIA_ALVO).rotulo('tipo de alvo'),
  motivo: campos.umDe(DENUNCIA_MOTIVOS),
  denunciadoId: uuid(),
  /* só o que ninguém pegou ainda — é como o moderador começa o dia */
  semResponsavel: campos.booleano(),
});

/**
 * Veredito.
 *
 * `resolucao` obrigatória e com piso: o veredito sem argumento é o que o
 * suporte não consegue defender quando o denunciado liga reclamando. O service
 * (`denuncia.resolucao.service`) exige o mesmo — a validação só devolve 422
 * antes de gastar uma ida ao banco.
 */
const resolucao = esquema({
  status: campos.umDe(STATUS_RESOLVIDOS).obrigatorio('Informe o desfecho da denúncia.'),
  acaoTomada: campos.umDe(ACOES_TOMADAS).obrigatorio('Informe a providência tomada.'),
  resolucao: campos
    .textoLongo()
    .obrigatorio('Descreva a decisão.')
    .min(MOTIVO_MINIMO, `A decisão precisa de ao menos ${MOTIVO_MINIMO} caracteres.`)
    .max(2000),
  /* o padrão é resolver todas as denúncias do mesmo alvo de uma vez: dez
     pessoas denunciaram o mesmo anúncio e a decisão vale para as dez */
  emLote: campos.booleano().padrao(true),
});

const listarConversas = esquema({
  ...listagemBase,
  status: campos.umDe(CONVERSA_STATUS),
  anuncioId: uuid(),
  usuarioId: uuid(),
  /* a entrada normal desta tela: conversas que têm denúncia em aberto */
  comDenuncia: campos.booleano(),
});

/**
 * ⚠️ O esquema mais importante do módulo.
 *
 * `GET /conversas/:id` entrega ao Admin mensagem privada trocada entre duas
 * pessoas que não são ele. É a operação mais invasiva do sistema inteiro, e a
 * cliente pediu que ela existisse — então ela existe **com preço**: sem motivo
 * escrito, não há leitura.
 *
 * O mínimo é maior que o dos demais motivos de propósito. "abuso" cabe em
 * `MOTIVO_MINIMO` e não explica nada; 10 caracteres forçam uma frase curta, que
 * é o que faz sentido para quem, meses depois, precisa responder ao titular
 * perguntando por que suas mensagens foram lidas (LGPD, art. 18).
 *
 * `denunciaId` é opcional e não decorativo: quando a leitura decorre de uma
 * denúncia, o vínculo é registrado junto e a justificativa deixa de depender só
 * do texto livre.
 */
const motivoAcesso = esquema({
  motivo: campos
    .textoLongo()
    .obrigatorio('Registre o motivo para ler esta conversa.')
    .min(10, 'Descreva o motivo do acesso com ao menos 10 caracteres.')
    .max(500),
  denunciaId: uuid(),
  /* paginação por cursor: chat não usa offset (ver conversa.historico.service) */
  antesDe: campos.texto().max(200),
  limite: campos.inteiro().min(1).max(100),
});

/**
 * Comunicado em massa.
 *
 * `publicoEsperado` é obrigatório e não é enfeite: é a confirmação explícita de
 * quantas pessoas o Admin ACHA que vai atingir. O service conta o público real
 * antes de enfileirar e recusa se a diferença passar da tolerância. Mandar para
 * a base inteira por um filtro errado não tem desfazer — a notificação já
 * chegou no celular de todo mundo.
 */
const comunicado = esquema({
  tipo: campos.umDe(NOTIFICACAO_TIPO).padrao('sistema').rotulo('tipo do aviso'),
  titulo: campos.texto().obrigatorio('Escreva o título.').min(3).max(160),
  mensagem: campos.textoLongo().obrigatorio('Escreva a mensagem.').min(3).max(2000),
  dados: campos.objeto({ link: campos.texto().max(500) }),
  canais: campos.lista(campos.umDe(NOTIFICACAO_CANAL)).max(4),

  segmento: campos.objeto({
    status: campos.lista(campos.umDe(USUARIO_STATUS)).max(USUARIO_STATUS.length),
    tipoPerfil: campos.umDe(PERFIL_TIPO).rotulo('tipo de perfil'),
    uf: campos.texto().min(2).max(2),
    /* teto alto porque aqui a lista é o público, não um lote de ações */
    usuarioIds: campos.lista(uuid()).max(5000),
  }),

  publicoEsperado: campos
    .inteiro()
    .obrigatorio('Confirme quantas pessoas este comunicado deve atingir.')
    .min(0)
    .max(1000000),
  /* fração de divergência aceita entre o esperado e o real */
  tolerancia: campos.numero().min(0).max(1).padrao(0.2),

  motivo: campos.texto().max(300),
});

const template = esquema({
  assunto: campos.texto().max(180),
  titulo: campos.texto().max(160),
  corpo: campos.textoLongo().max(5000),
  corpoHtml: campos.textoLongo().max(20000),
  variaveis: campos.lista(campos.texto().max(40)).max(50),
  ativo: campos.booleano(),
});

// ─── PLATAFORMA ─────────────────────────────────────────────────

/**
 * `valor` é `campos.livre()` porque o tipo aceito depende da CHAVE, conhecida
 * só depois de consultar o banco — a validação real é de
 * `configuracao.tipo.service`, contra o `tipo` gravado. `permitindoNulo`
 * porque limpar uma configuração é diferente de esquecer o campo.
 */
const configuracao = esquema({
  valor: campos.livre().permitindoNulo(),
  motivo: campos.texto().max(300),
});

/**
 * Plano — o mesmo esquema serve POST e PATCH (a rota é uma só para os dois).
 *
 * Por isso NADA é obrigatório aqui: exigir `chave` faria o PATCH que só troca o
 * preço reenviar a chave, e chave de plano não se edita. Quem cobra a presença
 * de `chave` e `nome` na criação é `plataforma`, que sabe qual das duas
 * operações está rodando.
 */
const plano = esquema({
  chave: campos
    .texto()
    .min(3)
    .max(40)
    .minusculo()
    .padraoTexto(/^[a-z0-9_]+$/, 'Use apenas letras minúsculas, números e underline.'),
  nome: campos.texto().min(2).max(80),
  descricao: campos.textoLongo().max(1000),
  precoCentavos: campos.inteiro().min(0),
  periodicidade: campos.umDe(PLANO_PERIODICIDADE),
  diasTeste: campos.inteiro().min(0).max(365),
  publico: campos.booleano(),
  ativo: campos.booleano(),
  ordem: campos.inteiro().min(0),

  /* limites na própria criação: sem isto, o validador descartava o campo em
     silêncio e o plano nascia sem teto nenhum — a tela parecia ter funcionado
     e o limite simplesmente não existia */
  limites: campos.lista(
    campos.objeto({
      chave: campos.texto().obrigatorio('Informe a chave do limite.').max(60),
      valor: campos.inteiro().min(0).permitindoNulo(),
      periodo: campos.texto().max(20),
    })
  ),
});

/** `valor: null` é "ilimitado", não "campo esquecido" — daí `permitindoNulo` */
const limites = esquema({
  limites: campos
    .lista(
      campos.objeto({
        chave: campos.texto().obrigatorio('Informe a chave do limite.').min(2).max(60),
        valor: campos.inteiro().min(0, 'Limite não pode ser negativo.').permitindoNulo(),
        periodo: campos.umDe(['dia', 'semana', 'mes', 'ano', 'total']).padrao('total'),
        descricao: campos.texto().max(255),
      })
    )
    .obrigatorio('Informe a lista de limites.')
    .max(100),
});

const atribuirPlano = esquema({
  usuarioId: uuidObrigatorio('Informe o usuário.'),
  planoId: uuid(),
  planoChave: campos.texto().max(40).minusculo(),
  motivo: campos.texto().max(300),
  fimEm: campos.data(),
});

const papelNovo = esquema({
  chave: campos
    .texto()
    .obrigatorio('Informe a chave do papel.')
    .min(3)
    .max(40)
    .minusculo()
    .padraoTexto(/^[a-z0-9_]+$/, 'Use apenas letras minúsculas, números e underline.'),
  nome: campos.texto().obrigatorio('Informe o nome do papel.').min(2).max(80),
  descricao: campos.textoLongo().max(500),
  /* permissão é chave técnica no formato `recurso.acao[.escopo]` */
  permissoes: campos
    .lista(campos.texto().max(80).minusculo().padraoTexto(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/, 'Permissão inválida.'))
    .max(400),
});

const papelEdicao = esquema({
  nome: campos.texto().min(2).max(80),
  descricao: campos.textoLongo().max(500),
  permissoes: campos
    .lista(campos.texto().max(80).minusculo().padraoTexto(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/, 'Permissão inválida.'))
    .max(400),
});

// ─── CONFORMIDADE ───────────────────────────────────────────────

const listarSolicitacoes = esquema({
  ...listagemBase,
  tipo: campos.umDe(TITULAR_SOLICITACAO_TIPO).rotulo('tipo de solicitação'),
  status: campos.umDe(TITULAR_SOLICITACAO_STATUS),
  /* as que já passaram do prazo legal de 15 dias — a primeira coisa a olhar */
  vencidas: campos.booleano(),
  usuarioId: uuid(),
});

/**
 * Resposta ao titular. Só status FINAL: "em atendimento" não é resposta, e
 * deixar essa transição aqui faria o prazo do art. 19 parecer cumprido sem que
 * ninguém tivesse respondido nada.
 */
const respostaTitular = esquema({
  status: campos.umDe(STATUS_FINAIS).obrigatorio('Informe o desfecho da solicitação.'),
  resposta: campos
    .textoLongo()
    .obrigatorio('Escreva a resposta ao titular.')
    .min(MOTIVO_MINIMO)
    .max(5000),
  anexoUrl: campos.texto().max(500),
});

const documentoLegal = esquema({
  tipo: campos.umDe(DOCUMENTO_LEGAL_TIPO).obrigatorio('Informe o tipo do documento.'),
  versao: campos
    .texto()
    .obrigatorio('Informe a versão.')
    .max(20)
    .padraoTexto(/^[0-9]+(\.[0-9]+)*$/, 'Use versionamento numérico (ex.: 2.1).'),
  conteudo: campos.textoLongo().obrigatorio('Informe o conteúdo do documento.').min(50),
  resumoMudancas: campos.textoLongo().max(2000),
  titulo: campos.texto().max(180),

  /* nomes iguais aos da feature `lgpd`. Antes o painel usava `vigenteEm`/
     `exigirAceite` e o service traduzia — tradução de nome entre camadas é
     onde um renomeio futuro passa despercebido */
  vigenteDe: campos.data(),
  exigeNovoAceite: campos.booleano().padrao(true),

  /* aceitos por compatibilidade com o que já foi escrito no painel */
  vigenteEm: campos.data(),
  exigirAceite: campos.booleano(),
});

/**
 * Trilha — serve `GET /auditoria` e `GET /auditoria/acessos-a-dados`.
 *
 * Só filtros POSITIVOS, pela mesma razão de `auditoria.validators`: um filtro
 * por exclusão deixaria o auditado estreitar a trilha até sumir com as próprias
 * linhas, e uma trilha assim não prova nada. `auditoria.consulta.service`
 * recusa explicitamente os nomes que alguém tentaria.
 */
const trilha = esquema({
  ...listagemBase,
  atorId: uuid(),
  emNomeDe: uuid(),
  titularId: uuid(),
  acao: campos.umDe(AUDITORIA_ACAO),
  entidade: campos.texto().max(60),
  entidadeId: uuid(),
  recurso: campos.texto().max(60),
});

/** exportar leva dado pessoal para fora do sistema: motivo obrigatório */
const exportacao = esquema({
  formato: campos.umDe(FORMATOS_EXPORTACAO).padrao('json'),
  ...recorteDeData,
  atorId: uuid(),
  acao: campos.umDe(AUDITORIA_ACAO),
  entidade: campos.texto().max(60),
  entidadeId: uuid(),
  motivo: motivoTexto('Registre o motivo da exportação.'),

  /* qual relatório exportar. Sem o campo, toda exportação saía como `painel`
     independentemente do que a tela pediu */
  relatorio: campos.umDe(['painel', 'desempenho', 'busca']).padrao('painel'),
});

module.exports = {
  /* constantes que os services do painel reaproveitam */
  LOTE_MAXIMO,
  COLECOES,
  ACOES_SANCAO,
  ACOES_MODERACAO,
  FORMATOS_EXPORTACAO,

  periodo,
  listagem,
  identificador,
  identificadorPapel,

  listarUsuarios,
  editarUsuario,
  sancao,
  motivo,
  motivoOpcional,
  papel,
  loteSancao,

  listarPerfis,
  verificacao,

  listarAnuncios,
  editarAnuncio,
  filaModeracao,
  destaque,
  anuncioEmNomeDe,
  loteModeracao,

  colecao,
  colecaoItem,
  itemCatalogo,
  ordenacao,

  listarDenuncias,
  resolucao,
  listarConversas,
  motivoAcesso,
  comunicado,
  template,

  configuracao,
  plano,
  limites,
  atribuirPlano,
  papelNovo,
  papelEdicao,

  listarSolicitacoes,
  respostaTitular,
  documentoLegal,
  trilha,
  exportacao,
};
