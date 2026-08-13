'use strict';

const db = require('../../models');
const config = require('../../config');
const filas = require('../../filas');
const storage = require('../../providers/storage');
const { exigir } = require('../../rbac');
const { erros } = require('../../utils/erros');
const inspecao = require('./midia.inspecao.service');
const armazenamento = require('./midia.armazenamento.service');
const { PASTAS, REFERENCIAS } = require('./midia.constants');

/**
 * Recebimento do arquivo.
 *
 * A regra que organiza este service inteiro: **a resposta não redimensiona
 * nada**. Gerar três variantes de uma foto de celular leva de 300ms a 2s de
 * CPU; multiplicado por dez fotos de um anúncio, o anunciante fica olhando
 * para um spinner e o processo web fica sem núcleo para atender quem está
 * navegando. Aqui só acontece o que é barato e obrigatório: conferir,
 * gravar o original e enfileirar. O registro volta na hora, com status
 * `processando`, e o front já mostra a foto usando a URL do original.
 */

/** pasta por ano/mês: diretório com centenas de milhares de entradas fica lento */
function pastaDoOriginal() {
  const agora = new Date();
  const mes = String(agora.getUTCMonth() + 1).padStart(2, '0');
  return `${PASTAS.originais}/${agora.getUTCFullYear()}/${mes}`;
}

/**
 * O mesmo arquivo já enviado por esta pessoa vira reaproveitamento em vez de
 * cópia. Acontece mais do que parece: o anunciante sobe a mesma foto no
 * anúncio da colheitadeira e na do plantio. Guardar duas vezes custa espaço e
 * uma segunda rodada de processamento pelo mesmo resultado.
 */
function procurarIgual(usuarioId, hash) {
  return db.Arquivo.findOne({
    where: { usuario_id: usuarioId, hash_conteudo: hash, referencia_tipo: null },
    order: [['criado_em', 'DESC']],
  });
}

/**
 * @param entrada.arquivos   `[{ buffer, originalname }]` já parseados do multipart
 * @param entrada.referenciaTipo/referenciaId  vínculo opcional (anúncio, perfil)
 */
async function enviar(entrada, contexto) {
  /* capacidade já foi conferida na rota; aqui a checagem é de ESCOPO, e o dono
     do arquivo que está nascendo é sempre quem está enviando — por isso
     `donoId` é o próprio usuário e nunca um id vindo do corpo */
  exigir(contexto, 'arquivo.enviar', { donoId: contexto.usuarioId });

  const lista = entrada.arquivos || [];

  if (!lista.length) {
    throw erros.validacao({ arquivos: 'Envie ao menos uma imagem.' });
  }

  if (lista.length > config.midia.maxArquivosPorRequisicao) {
    throw erros.validacao({
      arquivos: `Envie no máximo ${config.midia.maxArquivosPorRequisicao} imagens por vez.`,
    });
  }

  if (entrada.referenciaTipo && !REFERENCIAS.includes(entrada.referenciaTipo)) {
    throw erros.validacao({ referenciaTipo: 'Vínculo desconhecido.' });
  }

  /* inspeção ANTES de qualquer gravação: um lote com uma imagem reprovada não
     pode deixar as outras já no disco, órfãs de um registro que não veio */
  const inspecionados = [];
  for (const arquivo of lista) {
    inspecionados.push({ arquivo, meta: await inspecao.inspecionar(arquivo) });
  }

  const criados = [];
  const gravadosAgora = [];

  try {
    for (const { arquivo, meta } of inspecionados) {
      /* o reaproveitamento só vale para upload solto: se esta requisição já
         traz vínculo, reusar uma linha existente mudaria o vínculo de um
         arquivo que talvez esteja em uso em outro anúncio */
      const existente = entrada.referenciaTipo
        ? null
        : await procurarIgual(contexto.usuarioId, meta.hash);
      if (existente) {
        criados.push(existente);
        continue;
      }

      /* o nome no disco sai do provider (UUID). Nada do que o cliente mandou
         — nem nome, nem extensão — participa do caminho: a extensão usada é a
         que corresponde à assinatura binária lida, não a do arquivo enviado */
      const salvo = await storage.salvar(arquivo.buffer, {
        pasta: pastaDoOriginal(),
        extensao: meta.extensao,
      });
      gravadosAgora.push(salvo.caminho);

      criados.push(
        await db.Arquivo.create({
          usuario_id: contexto.usuarioId,
          driver: storage.motor(),
          path: salvo.caminho,
          url: storage.url(salvo.caminho),
          nome_original: meta.nomeOriginal,
          mime: meta.mime,
          tamanho_bytes: meta.tamanho,
          hash_conteudo: meta.hash,
          referencia_tipo: entrada.referenciaTipo || null,
          referencia_id: entrada.referenciaId || null,
        })
      );
    }
  } catch (erro) {
    /* o que já foi para o disco nesta requisição não pode ficar lá sem linha
       no banco: seria lixo que nem a faxina de órfãos encontra, porque a
       faxina parte do inventário */
    await Promise.all(gravadosAgora.map((caminho) => armazenamento.remover(caminho)));
    throw erro;
  }

  await Promise.all(
    criados.map((arquivo) =>
      filas
        .enfileirar(
          'midia.processar',
          { arquivoId: arquivo.id },
          /* chave única evita que reenviar o formulário duas vezes empilhe o
             mesmo processamento; o job é idempotente de qualquer forma, a
             chave só poupa CPU */
          { chaveUnica: `midia.processar:${arquivo.id}` }
        )
        /* falha ao enfileirar não pode perder o upload: o arquivo está salvo
           e a faxina periódica reenfileira o que ficou sem variante */
        .catch((erro) => console.error('[midia] falha ao enfileirar', arquivo.id, erro.message))
    )
  );

  return criados;
}

module.exports = { enviar };
