'use strict';

const { Router } = require('express');
const { autenticar, autorizar, validar, rateLimit, queryBruta } = require('../../middlewares');
const { somenteAdmin } = require('../../middlewares/autorizar');

const painel = require('./controllers/admin.painel.controller');
const usuarios = require('./controllers/admin.usuarios.controller');
const conteudo = require('./controllers/admin.conteudo.controller');
const catalogo = require('./controllers/admin.catalogo.controller');
const comunidade = require('./controllers/admin.comunidade.controller');
const plataforma = require('./controllers/admin.plataforma.controller');
const conformidade = require('./controllers/admin.conformidade.controller');

const esquemas = require('./admin.validators');

/**
 * Painel administrativo — a superfície do Admin, num lugar só.
 *
 * Por que existe, se as features já têm as regras: porque a tela do Admin não
 * é a soma das telas dos usuários. Ela agrupa por TAREFA («preciso resolver as
 * denúncias de hoje»), não por entidade, e quase toda tarefa cruza várias
 * features — a fila de moderação lê anúncio, denúncia, perfil e histórico ao
 * mesmo tempo. Espalhar isso pelas features faria cada uma conhecer as outras.
 *
 * O que este módulo NÃO faz:
 *
 *   - **não reimplementa regra de negócio.** Suspender usuário continua sendo
 *     `usuario.moderacao.service`; publicar continua sendo
 *     `anuncio.publicacao.service`. Aqui é composição, não cópia — duplicar a
 *     regra garantiria que um dia as duas divergissem;
 *   - **não cria poder novo.** `admin.acessar` abre a porta; cada operação lá
 *     dentro exige a permissão do recurso que manipula. Um moderador entra no
 *     painel e não enxerga configuração nem plano.
 *
 * O que ele acrescenta: visão agregada, ação em lote e **representação** —
 * agir em nome de um usuário, com o rastro registrando quem de fato agiu.
 *
 * Ordem dos middlewares: limite → autenticação → autorização → validação.
 */

const router = Router();

/* a porta do painel. Tudo abaixo já chega autenticado e com direito de entrar;
   as permissões finas continuam por rota */
router.use(autenticar, autorizar('admin.acessar'));

// ─── PAINEL ────────────────────────────────────────────────────
router.get('/painel', painel.resumo);
router.get('/painel/pendencias', painel.pendencias);
router.get('/painel/metricas', validar.query(esquemas.periodo), painel.metricas);
router.get('/painel/atividade', validar.query(esquemas.listagem), painel.atividade);
router.get('/painel/saude', somenteAdmin, painel.saude);

// ─── USUÁRIOS ──────────────────────────────────────────────────
router.get('/usuarios', autorizar('usuario.ler'), validar.query(esquemas.listarUsuarios), usuarios.listar);
router.get('/usuarios/:id', autorizar('usuario.ler'), validar.params(esquemas.identificador), usuarios.ver);
router.get('/usuarios/:id/atividade', autorizar('usuario.ler'), validar.params(esquemas.identificador), usuarios.atividade);
router.patch('/usuarios/:id', rateLimit.escrita(), autorizar('usuario.editar'), validar.params(esquemas.identificador), validar(esquemas.editarUsuario), usuarios.editar);

router.post('/usuarios/:id/suspender', rateLimit.escrita(), autorizar('usuario.suspender'), validar.params(esquemas.identificador), validar(esquemas.sancao), usuarios.suspender);
router.post('/usuarios/:id/banir', rateLimit.escrita(), autorizar('usuario.banir'), validar.params(esquemas.identificador), validar(esquemas.sancao), usuarios.banir);
router.post('/usuarios/:id/restaurar', rateLimit.escrita(), autorizar('usuario.restaurar'), validar.params(esquemas.identificador), validar(esquemas.motivo), usuarios.restaurar);
router.post('/usuarios/:id/encerrar-sessoes', rateLimit.escrita(), autorizar('usuario.encerrar_sessoes'), validar.params(esquemas.identificador), usuarios.encerrarSessoes);

router.get('/usuarios/:id/papeis', autorizar('rbac.ler'), validar.params(esquemas.identificador), usuarios.listarPapeis);
router.post('/usuarios/:id/papeis', rateLimit.escrita(), autorizar('rbac.atribuir_papel'), validar.params(esquemas.identificador), validar(esquemas.papel), usuarios.atribuirPapel);
router.delete('/usuarios/:id/papeis/:papel', rateLimit.escrita(), autorizar('rbac.atribuir_papel'), validar.params(esquemas.identificadorPapel), usuarios.removerPapel);

router.post('/usuarios/lote/sancionar', rateLimit.escrita(), autorizar('usuario.suspender'), validar(esquemas.loteSancao), usuarios.sancionarEmLote);

// ─── PERFIS ────────────────────────────────────────────────────
router.get('/perfis', autorizar('perfil.ler'), validar.query(esquemas.listarPerfis), usuarios.listarPerfis);
router.post('/perfis/:id/verificar', rateLimit.escrita(), autorizar('perfil.verificar'), validar.params(esquemas.identificador), validar(esquemas.verificacao), usuarios.verificarPerfil);
router.delete('/perfis/:id/verificar', rateLimit.escrita(), autorizar('perfil.verificar'), validar.params(esquemas.identificador), validar(esquemas.motivo), usuarios.revogarVerificacao);

// ─── CONTEÚDO: ANÚNCIOS E MODERAÇÃO ────────────────────────────
router.get('/anuncios', autorizar('anuncio.ler'), validar.query(esquemas.listarAnuncios), conteudo.listar);
router.get('/anuncios/:id', autorizar('anuncio.ler'), validar.params(esquemas.identificador), conteudo.ver);
router.patch('/anuncios/:id', rateLimit.escrita(), autorizar('anuncio.editar'), validar.params(esquemas.identificador), validar(esquemas.editarAnuncio), conteudo.editar);
router.delete('/anuncios/:id', rateLimit.escrita(), autorizar('anuncio.remover'), validar.params(esquemas.identificador), validar(esquemas.motivo), conteudo.remover);

router.get('/moderacao/fila', autorizar('anuncio.ler'), validar.query(esquemas.filaModeracao), conteudo.fila);
router.post('/anuncios/:id/aprovar', rateLimit.escrita(), autorizar('anuncio.aprovar'), validar.params(esquemas.identificador), validar(esquemas.motivoOpcional), conteudo.aprovar);
router.post('/anuncios/:id/reprovar', rateLimit.escrita(), autorizar('anuncio.reprovar'), validar.params(esquemas.identificador), validar(esquemas.motivo), conteudo.reprovar);
router.post('/anuncios/:id/ocultar', rateLimit.escrita(), autorizar('anuncio.ocultar'), validar.params(esquemas.identificador), validar(esquemas.motivo), conteudo.ocultar);
router.post('/anuncios/:id/destacar', rateLimit.escrita(), autorizar('anuncio.destacar'), validar.params(esquemas.identificador), validar(esquemas.destaque), conteudo.destacar);

/* publicar em nome do anunciante: o produtor liga pedindo ajuda e o Admin
   cadastra por ele. A auditoria registra quem agiu e por quem */
router.post('/anuncios/em-nome-de', rateLimit.escrita(), autorizar('anuncio.criar_em_nome_de'), validar(esquemas.anuncioEmNomeDe), conteudo.criarEmNomeDe);

router.post('/anuncios/lote/moderar', rateLimit.escrita(), autorizar('anuncio.aprovar'), validar(esquemas.loteModeracao), conteudo.moderarEmLote);

router.post('/fotos/:id/bloquear', rateLimit.escrita(), autorizar('anuncio_foto.bloquear'), validar.params(esquemas.identificador), validar(esquemas.motivo), conteudo.bloquearFoto);
router.get('/midia', autorizar('arquivo.remover'), validar.query(esquemas.listagem), conteudo.listarMidia);
router.delete('/midia/:id', rateLimit.escrita(), autorizar('arquivo.remover'), validar.params(esquemas.identificador), validar(esquemas.motivo), conteudo.removerMidia);

// ─── CATÁLOGO ──────────────────────────────────────────────────
router.get('/catalogo/:colecao', autorizar('categoria.criar'), validar.params(esquemas.colecao), validar.query(esquemas.listagem), catalogo.listar);
router.post('/catalogo/:colecao', rateLimit.escrita(), validar.params(esquemas.colecao), validar(esquemas.itemCatalogo), catalogo.criar);
/* `/ordenar` ANTES de `/:id`: o Express casa na ordem de declaração, e com
   `:id` primeiro a palavra "ordenar" viraria um identificador — a rota de
   reordenação nunca seria alcançada */
router.patch('/catalogo/:colecao/ordenar', rateLimit.escrita(), validar.params(esquemas.colecao), validar(esquemas.ordenacao), catalogo.ordenar);
router.patch('/catalogo/:colecao/:id', rateLimit.escrita(), validar.params(esquemas.colecaoItem), validar(esquemas.itemCatalogo), catalogo.editar);
router.delete('/catalogo/:colecao/:id', rateLimit.escrita(), validar.params(esquemas.colecaoItem), catalogo.remover);

// ─── COMUNIDADE: DENÚNCIAS, CONVERSAS E COMUNICADOS ────────────
router.get('/denuncias', autorizar('denuncia.ler'), validar.query(esquemas.listarDenuncias), comunidade.listarDenuncias);
router.get('/denuncias/agrupadas', autorizar('denuncia.ler'), validar.query(esquemas.listagem), comunidade.denunciasAgrupadas);
router.get('/denuncias/:id', autorizar('denuncia.ler'), validar.params(esquemas.identificador), comunidade.verDenuncia);
router.post('/denuncias/:id/resolver', rateLimit.escrita(), autorizar('denuncia.resolver'), validar.params(esquemas.identificador), validar(esquemas.resolucao), comunidade.resolverDenuncia);

/**
 * Conversas: leitura restrita e sempre registrada.
 *
 * Ler mensagem privada é a operação mais invasiva do painel. Exige denúncia
 * vinculada ou permissão explícita, e grava em `logs_acesso_dado` — ver
 * `documentacao/features/Admin.md` §4.
 */
router.get('/conversas', autorizar('conversa.ler'), validar.query(esquemas.listarConversas), comunidade.listarConversas);
router.get('/conversas/:id', autorizar('conversa.ler'), validar.params(esquemas.identificador), validar.query(esquemas.motivoAcesso), comunidade.verConversa);
router.delete('/mensagens/:id', rateLimit.escrita(), autorizar('mensagem.remover'), validar.params(esquemas.identificador), validar(esquemas.motivo), comunidade.removerMensagem);

router.get('/comunicados', autorizar('notificacao.enviar'), validar.query(esquemas.listagem), comunidade.listarComunicados);
router.post('/comunicados', rateLimit.escrita(), autorizar('notificacao.enviar'), validar(esquemas.comunicado), comunidade.enviarComunicado);
router.get('/notificacoes/templates', autorizar('notificacao.template_editar'), comunidade.listarTemplates);
router.put('/notificacoes/templates/:id', rateLimit.escrita(), autorizar('notificacao.template_editar'), validar.params(esquemas.identificador), validar(esquemas.template), comunidade.salvarTemplate);

// ─── PLATAFORMA: CONFIGURAÇÃO, PLANOS E RBAC ───────────────────
router.get('/configuracoes', autorizar('configuracao.ler'), plataforma.listarConfiguracoes);
router.put('/configuracoes/:chave', rateLimit.escrita(), autorizar('configuracao.editar'), validar(esquemas.configuracao), plataforma.salvarConfiguracao);
router.get('/configuracoes/:chave/historico', autorizar('configuracao.ler'), validar.query(esquemas.listagem), plataforma.historicoConfiguracao);

router.get('/planos', autorizar('plano.ler'), plataforma.listarPlanos);
router.post('/planos', rateLimit.escrita(), autorizar('plano.criar'), validar(esquemas.plano), plataforma.criarPlano);
router.patch('/planos/:id', rateLimit.escrita(), autorizar('plano.editar'), validar.params(esquemas.identificador), validar(esquemas.plano), plataforma.editarPlano);
router.put('/planos/:id/limites', rateLimit.escrita(), autorizar('plano.editar'), validar.params(esquemas.identificador), validar(esquemas.limites), plataforma.definirLimites);
router.delete('/planos/:id', rateLimit.escrita(), autorizar('plano.remover'), validar.params(esquemas.identificador), plataforma.removerPlano);
router.post('/planos/atribuir', rateLimit.escrita(), autorizar('plano.atribuir'), validar(esquemas.atribuirPlano), plataforma.atribuirPlano);

router.get('/rbac/papeis', autorizar('rbac.ler'), plataforma.listarPapeis);
router.get('/rbac/permissoes', autorizar('rbac.ler'), plataforma.listarPermissoes);
router.post('/rbac/papeis', rateLimit.escrita(), autorizar('rbac.criar_papel'), validar(esquemas.papelNovo), plataforma.criarPapel);
router.patch('/rbac/papeis/:id', rateLimit.escrita(), autorizar('rbac.editar_papel'), validar.params(esquemas.identificador), validar(esquemas.papelEdicao), plataforma.editarPapel);
router.delete('/rbac/papeis/:id', rateLimit.escrita(), autorizar('rbac.remover_papel'), validar.params(esquemas.identificador), plataforma.removerPapel);

// ─── CONFORMIDADE: LGPD E AUDITORIA ────────────────────────────
router.get('/lgpd/solicitacoes', autorizar('lgpd.ler_solicitacoes'), validar.query(esquemas.listarSolicitacoes), conformidade.listarSolicitacoes);
router.get('/lgpd/solicitacoes/:id', autorizar('lgpd.ler_solicitacoes'), validar.params(esquemas.identificador), conformidade.verSolicitacao);
router.post('/lgpd/solicitacoes/:id/responder', rateLimit.escrita(), autorizar('lgpd.responder_solicitacao'), validar.params(esquemas.identificador), validar(esquemas.respostaTitular), conformidade.responderSolicitacao);
router.get('/lgpd/documentos', autorizar('lgpd.publicar_documento'), conformidade.listarDocumentos);
router.post('/lgpd/documentos', rateLimit.escrita(), autorizar('lgpd.publicar_documento'), validar(esquemas.documentoLegal), conformidade.publicarDocumento);

/* `queryBruta` antes da validação: sem ela, `?excluirAtor=<eu>` seria
   descartado em silêncio e o auditado sumiria da própria trilha achando que o
   filtro não existe. Com a cópia crua, o service recusa com 422 */
router.get('/auditoria', autorizar('auditoria.ler'), queryBruta, validar.query(esquemas.trilha), conformidade.trilha);
router.get('/auditoria/acessos-a-dados', autorizar('auditoria.ler'), queryBruta, validar.query(esquemas.trilha), conformidade.acessosADados);
router.post('/auditoria/exportar', rateLimit.escrita(), autorizar('auditoria.exportar'), validar(esquemas.exportacao), conformidade.exportarTrilha);

router.get('/relatorios', autorizar('relatorio.ler'), validar.query(esquemas.periodo), conformidade.relatorios);
router.post('/relatorios/exportar', rateLimit.escrita(), autorizar('relatorio.exportar'), validar(esquemas.exportacao), conformidade.exportarRelatorio);

module.exports = router;
