'use strict';

const denunciasService = require('../services/admin.comunidade.denuncias.service');
const conversasService = require('../services/admin.comunidade.conversas.service');
const comunicadosService = require('../services/admin.comunidade.comunicados.service');
const catchAsync = require('../../../utils/catch-async');
const resposta = require('../../../utils/resposta');

/**
 * Comunidade no painel: denúncias, conversas e comunicados.
 *
 * Só HTTP. Nenhuma das regras que importam neste módulo mora aqui — nem a
 * exigência de motivo para ler conversa, nem a conferência de público do
 * comunicado. As duas são regra de negócio e precisam valer também quando a
 * chamada vier de um job ou de um script de suporte, que não passam pelo
 * Express.
 *
 * As duas únicas decisões do controller são de CÓDIGO DE RESPOSTA, e ambas
 * dizem algo sobre a requisição, não sobre o domínio:
 *
 *   - comunicado responde **202**, não 200: o lote foi ACEITO, não entregue.
 *     Devolver 200 daria a entender que a base inteira já recebeu antes de o
 *     primeiro bloco do job rodar;
 *   - remoção de mensagem responde **200** com o registro, não 204: é soft
 *     delete, e o corpo confirma que a linha continua lá com a marca de
 *     removida — 204 sugeriria que a mensagem sumiu do banco.
 */

// ─── DENÚNCIAS ──────────────────────────────────────────────────

const listarDenuncias = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await denunciasService.listar(
    req.contexto,
    req.query
  );
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const denunciasAgrupadas = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await denunciasService.agrupadas(
    req.contexto,
    req.query
  );
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const verDenuncia = catchAsync(async (req, res) =>
  resposta.ok(res, await denunciasService.ver(req.contexto, req.params.id))
);

const resolverDenuncia = catchAsync(async (req, res) =>
  resposta.ok(res, await denunciasService.resolver(req.contexto, req.params.id, req.body), {
    mensagem: 'Denúncia resolvida.',
  })
);

// ─── CONVERSAS ──────────────────────────────────────────────────

const listarConversas = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await conversasService.listar(
    req.contexto,
    req.query
  );
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

/**
 * Leitura de conversa privada.
 *
 * O motivo vem na QUERY (`esquemas.motivoAcesso`) porque a rota é um GET — e
 * um GET com corpo é território cinzento que proxies e clientes tratam de
 * formas diferentes. O efeito colateral aceito é que o motivo aparece em log
 * de acesso HTTP; é texto escrito pelo próprio Admin sobre um trabalho dele,
 * não dado do titular.
 */
const verConversa = catchAsync(async (req, res) => {
  const dados = await conversasService.ver(req.contexto, req.params.id, {
    motivo: req.query.motivo,
    denunciaId: req.query.denunciaId,
    antesDe: req.query.antesDe,
    limite: req.query.limite,
  });

  resposta.ok(res, dados, {
    aviso: 'Esta leitura foi registrada em nome do titular dos dados (LGPD).',
  });
});

const removerMensagem = catchAsync(async (req, res) =>
  resposta.ok(
    res,
    await conversasService.removerMensagem(req.contexto, req.params.id, {
      motivo: req.body.motivo,
    }),
    { mensagem: 'Mensagem removida.' }
  )
);

// ─── COMUNICADOS E TEMPLATES ────────────────────────────────────

const listarComunicados = catchAsync(async (req, res) => {
  const { itens, pagina, porPagina, total } = await comunicadosService.listar(
    req.contexto,
    req.query
  );
  resposta.paginado(res, itens, { pagina, porPagina, total });
});

const enviarComunicado = catchAsync(async (req, res) =>
  resposta.aceito(res, await comunicadosService.enviar(req.contexto, req.body))
);

const listarTemplates = catchAsync(async (req, res) =>
  resposta.ok(res, await comunicadosService.listarTemplates())
);

const salvarTemplate = catchAsync(async (req, res) =>
  resposta.ok(res, await comunicadosService.salvarTemplate(req.contexto, req.params.id, req.body))
);

module.exports = {
  listarDenuncias,
  denunciasAgrupadas,
  verDenuncia,
  resolverDenuncia,
  listarConversas,
  verConversa,
  removerMensagem,
  listarComunicados,
  enviarComunicado,
  listarTemplates,
  salvarTemplate,
};
