'use strict';

/**
 * Dados de base do sistema: papéis, permissões, plano gratuito e configurações.
 *
 * O RBAC vem do catálogo em src/rbac — o seeder só chama o sincronizador, para
 * não existirem duas listas de permissões (uma no código, outra aqui) que
 * inevitavelmente divergem.
 */

const db = require('../src/models');
const { sincronizar } = require('../src/rbac');

const CONFIGURACOES = [
  { chave: 'anuncio.dias_validade', valor: 60, tipo: 'numero', grupo: 'anuncio', descricao: 'Dias até o anúncio expirar', publica: false },
  { chave: 'anuncio.max_fotos', valor: 8, tipo: 'numero', grupo: 'anuncio', descricao: 'Fotos por anúncio', publica: true },
  { chave: 'anuncio.moderacao_previa', valor: false, tipo: 'booleano', grupo: 'anuncio', descricao: 'Exigir aprovação antes de publicar', publica: false },
  { chave: 'anuncio.max_ativos_por_usuario', valor: null, tipo: 'numero', grupo: 'anuncio', descricao: 'Limite de anúncios ativos (null = ilimitado)', publica: false },
  { chave: 'chat.ativo', valor: true, tipo: 'booleano', grupo: 'chat', descricao: 'Chat interno disponível', publica: true },
  { chave: 'chat.admin_le_somente_com_denuncia', valor: true, tipo: 'booleano', grupo: 'chat', descricao: 'LGPD: Admin só abre conversa mediante denúncia', publica: false },
  { chave: 'contato.whatsapp_suporte', valor: '5565999999999', tipo: 'texto', grupo: 'contato', descricao: 'WhatsApp de suporte', publica: true },
  { chave: 'contato.email_suporte', valor: 'contato@agropecasmt.com.br', tipo: 'texto', grupo: 'contato', descricao: 'E-mail de suporte', publica: true },
  { chave: 'localizacao.produtor_aproximada', valor: true, tipo: 'booleano', grupo: 'privacidade', descricao: 'Produtor nasce com localização aproximada', publica: false },
];

module.exports = {
  async up() {
    await sincronizar(db);

    const [plano] = await db.Plano.findOrCreate({
      where: { chave: 'gratuito_mvp' },
      defaults: {
        chave: 'gratuito_mvp',
        nome: 'Gratuito',
        descricao: 'Plano do MVP: sem mensalidade, sem comissão e sem limite de anúncios.',
        preco_centavos: 0,
        periodicidade: 'vitalicio',
        publico: true,
        ativo: true,
        padrao: true,
        ordem: 0,
      },
    });

    /* limites nulos = ilimitado. As chaves existem desde já para que ligar
       cobrança seja alterar VALOR, não criar estrutura. */
    const limites = [
      { chave: 'anuncios.ativos', valor: null, periodo: 'total', descricao: 'Anúncios publicados ao mesmo tempo' },
      { chave: 'anuncios.por_mes', valor: null, periodo: 'mes', descricao: 'Publicações por mês' },
      { chave: 'fotos.por_anuncio', valor: 8, periodo: 'total', descricao: 'Fotos por anúncio' },
      { chave: 'destaques.por_mes', valor: 0, periodo: 'mes', descricao: 'Anúncios em destaque' },
    ];

    for (const limite of limites) {
      await db.PlanoLimite.findOrCreate({
        where: { plano_id: plano.id, chave: limite.chave },
        defaults: { ...limite, plano_id: plano.id },
      });
    }

    for (const configuracao of CONFIGURACOES) {
      await db.Configuracao.findOrCreate({
        where: { chave: configuracao.chave },
        defaults: configuracao,
      });
    }

    console.log('[seed] RBAC, plano gratuito e configurações aplicados');
  },

  async down() {
    await db.PapelPermissao.destroy({ where: {} });
    await db.Permissao.destroy({ where: {} });
    await db.Papel.destroy({ where: {} });
    await db.PlanoLimite.destroy({ where: {} });
    await db.Plano.destroy({ where: { chave: 'gratuito_mvp' } });
    await db.Configuracao.destroy({ where: {} });
  },
};
