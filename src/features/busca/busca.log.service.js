'use strict';

const db = require('../../models');
const filas = require('../../filas');
const { sha256 } = require('../../utils/hash');
const { TRABALHO_LOG } = require('./busca.constants');

/**
 * Registro do que as pessoas procuraram.
 *
 * ─── por que isto NUNCA roda no caminho da resposta ───
 *
 * Gravar em `busca_logs` é um INSERT por busca, na rota mais chamada do
 * sistema. Somado à consulta de resultados, dobraria o número de idas ao banco
 * de toda a operação mais frequente do produto — e o usuário estaria esperando
 * por uma gravação que não muda nada na tela dele. Vai para a fila: o
 * `enfileirar` é um push no Redis, o INSERT acontece no worker.
 *
 * Se a fila estiver fora do ar, a busca continua respondendo e o log se perde.
 * Essa é a ordem de prioridade correta: log de busca é insumo de relatório, não
 * registro de fato jurídico. Consentimento e auditoria, que são, gravam
 * síncronos nos seus próprios módulos.
 *
 * ─── LGPD ───
 *
 * O IP entra em hash (`utils/hash.js`), nunca em claro — a coluna se chama
 * `ip_hash` exatamente por isso. O mesmo vale para a sessão: `sessao_hash`
 * permite juntar "esta pessoa buscou X, depois Y, depois clicou em Z" sem
 * guardar nada que identifique quem é. `usuario_id` só é gravado quando a
 * pessoa está logada, e aí ela já é identificada de qualquer forma.
 */

/**
 * Identificador pseudônimo da sessão.
 *
 * Usa a sessão quando há login e cai no hash do IP quando não há — é o que
 * permite ligar a busca ao clique do visitante anônimo, que é a maioria. Os
 * dois já são hash: nada identificável entra nesta coluna.
 */
const hashDeSessao = (contexto = {}) =>
  contexto.sessaoId ? sha256(contexto.sessaoId) : contexto.ipHash || null;

/** o que o job precisa saber; nada de `req` aqui — service não conhece HTTP */
function montarPayload({ filtros, total, contexto = {}, origem }) {
  return {
    usuarioId: contexto.usuarioId || null,
    termo: filtros.termo || null,
    termoNormalizado: filtros.termoNormalizado || null,

    categoriaSlug: filtros.categoria || null,
    marcaSlug: filtros.marca || null,
    maquinaSlug: filtros.maquina || null,
    municipioId: filtros.municipioId || null,
    uf: filtros.uf || null,

    /* o JSONB guarda o recorte para o relatório poder responder "quantos
       filtraram por preço e não acharam nada" — pergunta que decide quais
       lojistas convidar para a plataforma */
    filtros: {
      tipo: filtros.tipo,
      condicao: filtros.condicao,
      precoMinCentavos: filtros.precoMinCentavos,
      precoMaxCentavos: filtros.precoMaxCentavos,
      aCombinar: filtros.aCombinar,
      dias: filtros.dias,
      ordem: filtros.ordem,
      porPagina: filtros.porPagina,
      pagina: filtros.pagina,
      cidade: filtros.cidade,
      proximidade: filtros.origemGeo ? { raioKm: filtros.origemGeo.raioKm, fonte: filtros.origemGeo.fonte } : null,
    },

    totalResultados: total,
    origem: origem || 'api',
    ipHash: contexto.ipHash || null,
    sessaoHash: hashDeSessao(contexto),
  };
}

/**
 * Enfileira o registro.
 *
 * Só a primeira página é registrada. Paginar não é uma nova busca: contar
 * cada página como uma multiplicaria o termo no ranking de "mais procurados"
 * pelo número de páginas que alguém folheou, e o topo da lista viraria o termo
 * com mais resultados em vez do mais procurado.
 */
async function registrar({ filtros, total, contexto, origem }) {
  if (filtros.pagina !== 1) return false;

  /* busca sem termo E sem filtro nenhum é a home carregando, não uma intenção
     de compra — poluiria o relatório com milhares de linhas vazias */
  const temIntencao =
    filtros.termoNormalizado || filtros.categoria || filtros.marca || filtros.maquina;
  if (!temIntencao) return false;

  await filas.enfileirar(TRABALHO_LOG, montarPayload({ filtros, total, contexto, origem }));
  return true;
}

/**
 * Marca em qual anúncio a pessoa clicou.
 *
 * Fecha o ciclo do relatório: termo com muitos resultados e nenhum clique é
 * pior do que termo sem resultado — significa que a plataforma TEM o item e
 * mesmo assim não respondeu à pergunta.
 *
 * Atualiza o log mais recente daquela sessão em vez de criar linha nova, e por
 * isso precisa do `sessao_hash`; sem sessão, o clique é ignorado em silêncio.
 */
async function registrarClique({ anuncioId, termoNormalizado, contexto = {} }) {
  const sessaoHash = hashDeSessao(contexto);
  if (!sessaoHash) return false;

  const alvo = await db.BuscaLog.findOne({
    where: {
      sessao_hash: sessaoHash,
      ...(termoNormalizado ? { termo_normalizado: termoNormalizado } : {}),
    },
    order: [['criado_em', 'DESC']],
    attributes: ['id'],
  });

  if (!alvo) return false;

  await db.BuscaLog.update({ clicou_em_anuncio_id: anuncioId }, { where: { id: alvo.id } });
  return true;
}

/**
 * A gravação de fato — chamada pelo WORKER, nunca por um controller.
 *
 * É `INSERT ... SELECT` com subconsultas em vez de três `findOne` antes:
 * categoria, marca e máquina chegam como slug (é o que está na URL) e viram id
 * dentro da mesma instrução. Três consultas de resolução por busca registrada,
 * multiplicadas pelo volume da rota mais chamada do sistema, seriam o dobro do
 * trabalho do próprio log.
 *
 * Nenhum valor entra no texto da consulta: tudo é bind parameter.
 */
async function gravar(payload = {}) {
  const bind = [
    payload.usuarioId || null,
    payload.termo || null,
    payload.termoNormalizado || null,
    payload.categoriaSlug || null,
    payload.marcaSlug || null,
    payload.maquinaSlug || null,
    payload.municipioId || null,
    payload.uf || null,
    JSON.stringify(payload.filtros || {}),
    Number(payload.totalResultados || 0),
    Number(payload.totalResultados || 0) === 0,
    payload.origem || 'api',
    payload.sessaoHash || null,
    payload.ipHash || null,
  ];

  await db.sequelize.query(
    `INSERT INTO busca_logs
       (id, usuario_id, termo, termo_normalizado,
        categoria_id, marca_id, maquina_id, municipio_id, uf,
        filtros, total_resultados, sem_resultado, origem, sessao_hash, ip_hash, criado_em)
     VALUES (
        gen_random_uuid(), $1::uuid, $2::text, $3::text,
        (SELECT id FROM categorias WHERE slug = $4::text LIMIT 1),
        (SELECT id FROM marcas     WHERE slug = $5::text LIMIT 1),
        (SELECT id FROM maquinas   WHERE slug = $6::text LIMIT 1),
        $7::uuid, $8::text, $9::jsonb, $10::int, $11::boolean, $12::text, $13::text, $14::text, now()
     )`,
    { bind }
  );

  return true;
}

module.exports = { registrar, registrarClique, gravar, montarPayload, hashDeSessao };
