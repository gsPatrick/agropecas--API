'use strict';

const { Router } = require('express');
const controller = require('./localizacao.controller');
const esquemas = require('./localizacao.validators');
const {
  autenticar,
  autenticacaoOpcional,
  validar,
  rateLimit,
} = require('../../middlewares');

/**
 * Rotas de localização. O arquivo é o mapa da feature.
 *
 * Ordem em toda rota: limite → validação → autenticação → controller. Limitar
 * antes de validar evita gastar CPU com requisição que já seria recusada.
 *
 * **Duas rotas batem em terceiro** (`/cep` e `/reverso`). Sem limite, elas
 * viram proxy gratuito para o ViaCEP e a BigDataCloud: alguém aponta um script
 * para cá, quem leva o bloqueio de IP somos nós, e o cadastro para de funcionar
 * para os usuários reais. O limite é mais apertado que o de leitura comum
 * justamente porque o custo não é nosso banco — é a nossa reputação com o
 * terceiro.
 */

const router = Router();

/* generoso o bastante para quem preenche um formulário (um CEP por campo,
   algumas correções), apertado o bastante para não servir de raspador */
const limiteIntegracao = () =>
  rateLimit({
    max: 40,
    janelaMs: 60 * 1000,
    mensagem: 'Muitas consultas seguidas. Aguarde um instante ou preencha o endereço manualmente.',
  });

// ─── consulta a terceiros ───────────────────────────────────────
router.get(
  '/cep/:cep',
  limiteIntegracao(),
  validar.params(esquemas.consultarCep),
  controller.consultarCep
);

router.get(
  '/reverso',
  limiteIntegracao(),
  validar.query(esquemas.reverso),
  controller.reverso
);

// ─── catálogo territorial (cache longo, dado público) ───────────
router.get('/estados', rateLimit.leitura(), controller.listarEstados);
router.get(
  '/municipios',
  rateLimit.leitura(),
  validar.query(esquemas.listarMunicipios),
  controller.listarMunicipios
);

// ─── distância ──────────────────────────────────────────────────
/* autenticação opcional: o visitante não logado também quer saber a distância
   (§9.2), mas quem está logado e é o dono recebe o valor exato */
router.post(
  '/distancia',
  rateLimit.leitura(),
  autenticacaoOpcional,
  validar(esquemas.distancia),
  controller.calcularDistancia
);

// ─── endereço ───────────────────────────────────────────────────
router.get(
  '/enderecos/:id',
  rateLimit.leitura(),
  autenticacaoOpcional,
  validar.params(esquemas.identificador),
  controller.verEndereco
);

/**
 * A capacidade não é verificável na rota: o mesmo endpoint grava endereço de
 * perfil e de anúncio, e a ação exigida (`perfil.editar` × `anuncio.editar`)
 * depende do corpo. Um `autorizar()` fixo aqui daria falsa sensação de
 * proteção — a verificação real acontece no service, junto do dono.
 */
router.post(
  '/enderecos',
  rateLimit.escrita(),
  autenticar,
  validar(esquemas.salvarEndereco),
  controller.salvarEndereco
);

module.exports = router;
