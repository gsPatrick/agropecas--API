'use strict';

const db = require('../../models');
const cache = require('../../cache');
const { erros } = require('../../utils/erros');
const { pode } = require('../../rbac');
const mapper = require('./perfil.mapper');
const chavesCache = require('./perfil.cache').chaves;
const { TTL_PERFIL_SEGUNDOS } = require('./perfil.constants');

/**
 * Leitura de perfil — a rota mais quente do sistema.
 *
 * Duas preocupações mandam neste arquivo:
 *
 * 1. **Cache.** `GET /perfis/:slug` é a página que o Google indexa e que
 *    aparece no link compartilhado no grupo de WhatsApp. Ela é idêntica para
 *    todo visitante, então é cacheável de graça. O que vai para o cache é o
 *    objeto JÁ MAPEADO (nunca instância do Sequelize) e já sem os campos que o
 *    consentimento esconde — assim um bug futuro no controller não consegue
 *    ressuscitar um dado que o mapper tinha removido.
 *
 * 2. **Nada de N+1.** Horários, serviços, marcas e área de atendimento vêm em
 *    `include`, numa consulta só. Buscar em laço aqui multiplicaria por cinco
 *    o custo da rota mais lida.
 */

/** as coleções do perfil, com `attributes` enxuto: card não usa descrição */
const INCLUDES_DETALHE = () => [
  {
    model: db.Municipio,
    as: 'municipio',
    attributes: ['id', 'nome', 'uf'],
    required: false,
  },
  {
    model: db.PerfilHorario,
    as: 'horarios',
    required: false,
    separate: true,
    order: [['dia_semana', 'ASC']],
  },
  {
    model: db.Servico,
    as: 'servicos',
    attributes: ['id', 'nome', 'slug', 'icone'],
    through: { attributes: ['preco_referencia_centavos', 'observacao', 'principal'] },
    required: false,
  },
  {
    model: db.Marca,
    as: 'marcas',
    attributes: ['id', 'nome', 'slug', 'logo_url'],
    through: { attributes: ['autorizada'] },
    required: false,
  },
  /* culturas e frota do produtor. `separate: true` na frota porque ela é
     hasMany com colunas próprias: no mesmo JOIN das outras coleções, o produto
     cartesiano multiplicaria as linhas de horários e serviços por máquina */
  {
    model: db.Cultura,
    as: 'culturas',
    attributes: ['id', 'nome', 'slug', 'grupo'],
    through: { attributes: ['principal'] },
    required: false,
  },
  {
    model: db.PerfilMaquina,
    as: 'maquinas',
    required: false,
    separate: true,
    order: [['criado_em', 'ASC']],
  },
  {
    model: db.Endereco,
    as: 'endereco',
    required: false,
  },
  {
    model: db.Municipio,
    as: 'areaAtendimento',
    attributes: ['id', 'nome', 'uf'],
    through: { attributes: ['taxa_deslocamento_centavos', 'observacao'] },
    required: false,
  },
];

/** carrega o registro completo, com todas as coleções, em uma ida ao banco */
const carregar = (where) => db.Perfil.findOne({ where, include: INCLUDES_DETALHE() });

const porSlug = (slug) => carregar({ slug });
const porId = (id) => carregar({ id });
const porUsuario = (usuarioId) => carregar({ usuario_id: usuarioId });

/**
 * Perfil público por slug — sem login.
 *
 * O 404 é o mesmo para "não existe" e "foi removido": confirmar que um slug
 * já existiu ajuda quem varre a base e não ajuda mais ninguém.
 */
async function publicoPorSlug(slug) {
  const dados = await cache.lembrar(
    chavesCache.detalhe(slug),
    async () => {
      const perfil = await porSlug(slug);
      return perfil ? mapper.publico(perfil) : null;
    },
    { ttl: TTL_PERFIL_SEGUNDOS }
  );

  if (!dados) throw erros.naoEncontrado('Perfil');
  return dados;
}

/**
 * Visualização do perfil público.
 *
 * `total_visualizacoes` é COLUNA, e o incremento é um `UPDATE` atômico
 * disparado sem `await` no caminho da resposta: contar visita não pode custar
 * latência na página mais lida, e um `COUNT(*)` por requisição seria pior
 * ainda. O `increment` do Sequelize vira `SET x = x + 1` no banco, então duas
 * visitas simultâneas não se perdem.
 *
 * Pendência conhecida: a visita do próprio dono também conta. Descontar exige
 * saber de quem é o perfil, e o objeto cacheado (mapper público) não carrega
 * `usuario_id` de propósito. Quando existir a tela de métricas, isto vira job.
 */
function contabilizarVisualizacao(perfilId) {
  if (!perfilId) return;

  db.Perfil.increment('total_visualizacoes', { by: 1, where: { id: perfilId } }).catch((erro) =>
    console.error('[perfil] falha ao contabilizar visualização', erro.message)
  );
}

/**
 * Perfil completo. Decide entre visão pública e privada pelo escopo de
 * `perfil.ler`, e não por papel — `if (papel === 'admin')` é proibido (§4).
 *
 * O documento (CPF/CNPJ) só sai para o dono e para quem tem escopo `.todos`; e
 * no segundo caso a leitura vira linha em `logs_acesso_dado`, porque abrir
 * dado pessoal de terceiro é acesso, não alteração — auditoria comum não pega.
 */
async function detalhar(perfil, contexto) {
  const proprio = String(perfil.usuario_id) === String(contexto?.usuarioId || '');

  if (!contexto?.autenticado || !pode(contexto, 'perfil.ler', { donoId: perfil.usuario_id })) {
    return mapper.publico(perfil);
  }

  if (!proprio) {
    await db.LogAcessoDado.create({
      ator_id: contexto.usuarioId,
      titular_id: perfil.usuario_id,
      recurso: 'perfil',
      recurso_id: perfil.id,
      motivo: 'leitura de perfil completo por escopo administrativo',
      ip_hash: contexto.ipHash || null,
      user_agent: contexto.userAgent || null,
    }).catch((erro) => console.error('[perfil] falha ao registrar acesso a dado', erro.message));
  }

  return mapper.privado(perfil, { comDocumento: true });
}

module.exports = {
  porSlug,
  porId,
  porUsuario,
  publicoPorSlug,
  detalhar,
  contabilizarVisualizacao,
  INCLUDES_DETALHE,
};
