'use strict';

const { Op } = require('sequelize');
const { registrar } = require('../registro');
const { FILAS } = require('../definicoes');

/**
 * Trabalhos de conformidade.
 *
 * Os três têm em comum o motivo de estarem aqui e não num service HTTP: cada
 * um toca a base inteira ou lê sete tabelas de uma conta. Num handler de
 * requisição, o primeiro segura um worker por minutos e o terceiro é uma
 * varredura noturna que não tem quem a chame.
 *
 * `require` dos models dentro do executor, e não no topo: o módulo de filas é
 * carregado no boot, antes da conexão com o banco, e importar os models aqui
 * em cima criaria uma dependência circular com `src/models`.
 */

/**
 * Monta e entrega o pacote de dados do titular (LGPD art. 18, V).
 *
 * O arquivo vai para o storage e o titular recebe um LINK TEMPORÁRIO — o
 * pacote não vai por e-mail. Anexar tudo sobre uma pessoa a uma mensagem de
 * e-mail é entregar o dado a qualquer servidor no caminho e deixá-lo na caixa
 * de entrada para sempre.
 */
const EXPORTAR_DADOS = registrar(
  'lgpd.exportarDados',
  async ({ usuarioId, solicitacaoId }) => {
    const db = require('../../models');
    const pacote = require('../../features/lgpd/lgpd.pacote.service');
    const link = require('../../features/lgpd/lgpd.link.service');
    const { LINK_MINUTOS } = require('../../features/lgpd/lgpd.constants');
    const filas = require('../index');

    const dados = await pacote.montar(usuarioId);
    if (!dados) return { exportado: false, motivo: 'usuario_inexistente' };

    const conteudo = Buffer.from(JSON.stringify(dados, null, 2), 'utf8');
    const { caminho } = await link.guardar(conteudo, { pasta: 'lgpd/exportacoes', extensao: 'json' });

    const { url, expiraEm } = await link.criar({
      caminho,
      donoId: usuarioId,
      nomeArquivo: `meus-dados-agropecas-${new Date().toISOString().slice(0, 10)}.json`,
      rota: '/v1/lgpd/downloads',
      minutos: LINK_MINUTOS,
    });

    /* inventário do storage: sem isto o arquivo vira lixo pago para sempre, e
       não há como cumprir um pedido de exclusão sobre ele */
    await db.Arquivo.create({
      usuario_id: usuarioId,
      driver: 'local',
      path: caminho,
      url,
      mime: 'application/json',
      tamanho_bytes: conteudo.length,
      referencia_tipo: 'lgpd_exportacao',
      referencia_id: solicitacaoId || null,
      /* o arquivo morre bem antes do prazo de retenção da conta: ele é uma
         cópia concentrada, não o registro original */
      descartar_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    if (solicitacaoId) {
      await db.SolicitacaoTitular.update(
        {
          status: 'concluida',
          respondida_em: new Date(),
          resposta: 'Exportação concluída. O link de download foi enviado ao e-mail cadastrado.',
          arquivo_url: url,
        },
        { where: { id: solicitacaoId } }
      );
    }

    const usuario = await db.Usuario.findByPk(usuarioId, { attributes: ['nome', 'email'] });

    if (usuario?.email) {
      await filas.enfileirar('email.enviar', {
        para: usuario.email,
        assunto: 'Seus dados estão prontos — AgroPeças MT',
        texto:
          `Olá, ${usuario.nome.split(' ')[0]}!\n\n` +
          `O arquivo com os seus dados está pronto:\n${url}\n\n` +
          `O link vale até ${new Date(expiraEm).toLocaleString('pt-BR')} e funciona UMA única vez. ` +
          `Você precisa estar logado na sua conta para baixá-lo.`,
      });
    }

    return { exportado: true, tamanhoBytes: conteudo.length };
  },
  { fila: FILAS.MANUTENCAO.nome }
);

/** Anonimização (art. 18, VI). A regra de cada campo está no service. */
const ANONIMIZAR = registrar(
  'lgpd.anonimizar',
  async ({ usuarioId, solicitadoPor, motivo }) => {
    const anonimizacao = require('../../features/lgpd/lgpd.anonimizacao.service');
    return anonimizacao.executar(usuarioId, { solicitadoPor, motivo });
  },
  { fila: FILAS.MANUTENCAO.nome }
);

/**
 * Expurgo do que passou do prazo de retenção.
 *
 * O princípio é o art. 15/16: terminado o tratamento, o dado é eliminado. Na
 * prática, o risco maior é o oposto do que se imagina — não é apagar cedo
 * demais, é nunca apagar, e a base virar um arquivo histórico de gente que
 * pediu para sair há três anos.
 *
 * Cada prazo abaixo veio de `documentacao/models/LGPD.md` §4 e está marcado
 * como **pendente de validação jurídica**. Nenhum deles toca em conta ativa.
 */
const EXPURGAR = registrar(
  'lgpd.expurgar',
  async () => {
    const db = require('../../models');
    const config = require('../../config');
    const agora = new Date();
    const dias = (n) => new Date(agora.getTime() - n * 24 * 60 * 60 * 1000);
    const resultado = {};

    /* contas anonimizadas cujo prazo de retenção acabou: some o que restava
       (sessão, token, favorito já foram na anonimização) e o registro vira
       casca. A LINHA em si permanece — apagá-la quebraria as chaves
       estrangeiras de anúncios e conversas da outra parte, que é exatamente o
       que a anonimização existe para evitar */
    const vencidas = await db.Usuario.findAll({
      where: {
        anonimizado_em: { [Op.ne]: null },
        excluir_definitivamente_em: { [Op.lt]: agora },
        observacoes_internas: null,
      },
      attributes: ['id'],
      limit: 500,
    });

    if (vencidas.length) {
      const ids = vencidas.map((linha) => linha.id);
      /* consentimentos de conta expurgada: a prova do aceite só serve enquanto
         houver relação; passado o prazo de defesa, guardar é acúmulo */
      resultado.consentimentosRemovidos = await db.Consentimento.destroy({
        where: { usuario_id: { [Op.in]: ids } },
      });
      resultado.contasVencidas = ids.length;
    }

    /* tentativas de login: 90 dias. Serve para detectar ataque em curso, não
       para arquivo histórico */
    resultado.tentativasRemovidas = await db.TentativaLogin.destroy({
      where: { criado_em: { [Op.lt]: dias(90) } },
    });

    /* busca com usuário identificado: 12 meses. Depois disso o termo continua
       útil para produto, o VÍNCULO com a pessoa não */
    const [buscasDesvinculadas] = await db.BuscaLog.update(
      { usuario_id: null, ip_hash: null },
      { where: { criado_em: { [Op.lt]: dias(365) }, usuario_id: { [Op.ne]: null } } }
    );
    resultado.buscasDesvinculadas = buscasDesvinculadas;

    /* arquivos órfãos marcados para descarte, inclusive pacotes de exportação
       expirados */
    const orfaos = await db.Arquivo.findAll({
      where: { descartar_em: { [Op.lt]: agora } },
      attributes: ['id', 'path'],
      limit: 200,
    });

    if (orfaos.length) {
      const storage = require('../../providers/storage');
      /* remoção do disco fora de transação e tolerante a falha: arquivo já
         ausente não pode travar a faxina do banco */
      await Promise.all(orfaos.map((linha) => storage.remover(linha.path).catch(() => null)));
      resultado.arquivosRemovidos = await db.Arquivo.destroy({
        where: { id: { [Op.in]: orfaos.map((linha) => linha.id) } },
        force: true,
      });
    }

    /* trilha de auditoria: 5 anos (prestação de contas de ação
       administrativa). Apagada POR DATA e nunca por ator — um expurgo que
       aceitasse alvo seria a porta dos fundos que a imutabilidade fecha */
    resultado.trilhaRemovida = await db.LogAuditoria.destroy({
      where: { criado_em: { [Op.lt]: dias(5 * 365) } },
    });

    resultado.acessosRemovidos = await db.LogAcessoDado.destroy({
      where: { criado_em: { [Op.lt]: dias(5 * 365) } },
    });

    resultado.retencaoDias = config.lgpd.retencaoDias;
    return resultado;
  },
  { fila: FILAS.MANUTENCAO.nome }
);

module.exports = { EXPORTAR_DADOS, ANONIMIZAR, EXPURGAR };
