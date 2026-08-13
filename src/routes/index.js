'use strict';

/**
 * Único agregador de rotas. Cada feature registra seu router aqui:
 *   router.use('/v1/anuncios', require('../features/anuncio/anuncio.routes'));
 *
 * Nada de endpoint solto fora das features — exceto health e version.
 */

const { Router } = require('express');
const { sequelize } = require('../models');

const router = Router();

router.get('/health', async (req, res) => {
  let banco = 'ok';
  try {
    await sequelize.authenticate();
  } catch (erro) {
    banco = 'indisponivel';
  }

  res.json({
    status: banco === 'ok' ? 'ok' : 'degradado',
    banco,
    versao: require('../../package.json').version,
    ambiente: process.env.NODE_ENV || 'development',
    horario: new Date().toISOString(),
  });
});

router.get('/v1/ping', (req, res) => res.json({ pong: true }));

// ─── FEATURES (registrar conforme forem construídas) ──────────
router.use('/v1/auth', require('../features/auth/auth.routes'));
router.use('/v1/configuracoes', require('../features/configuracao/configuracao.routes'));
router.use('/v1/usuarios', require('../features/usuario/usuario.routes'));
router.use('/v1/midia', require('../features/midia/midia.routes'));
router.use('/v1/catalogo', require('../features/catalogo/catalogo.routes'));
router.use('/v1/perfis', require('../features/perfil/perfil.routes'));
router.use('/v1/localizacao', require('../features/localizacao/localizacao.routes'));
router.use('/v1/anuncios', require('../features/anuncio/anuncio.routes'));
router.use('/v1/favoritos', require('../features/favorito/favorito.routes'));
router.use('/v1/contatos', require('../features/contato/contato.routes'));
router.use('/v1/conversas', require('../features/conversa/conversa.routes'));
router.use('/v1/notificacoes', require('../features/notificacao/notificacao.routes'));
router.use('/v1/lgpd', require('../features/lgpd/lgpd.routes'));
router.use('/v1/auditoria', require('../features/auditoria/auditoria.routes'));
router.use('/v1/denuncias', require('../features/denuncia/denuncia.routes'));
router.use('/v1/moderacao', require('../features/moderacao/moderacao.routes'));
router.use('/v1/planos', require('../features/plano/plano.routes'));
router.use('/v1/relatorios', require('../features/relatorio/relatorio.routes'));
router.use('/v1/busca', require('../features/busca/busca.routes'));
// router.use('/v1/anuncios', require('../features/anuncio/anuncio.routes'));
router.use('/v1/admin', require('../features/admin/admin.routes'));

module.exports = router;
