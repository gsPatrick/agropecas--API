'use strict';

/**
 * Saída dos relatórios.
 *
 * Aqui o mapper tem um papel diferente do resto do projeto: os services já
 * devolvem objeto simples (`raw: true` nas agregações), então não há instância
 * do Sequelize para filtrar. O que este arquivo garante é o **formato
 * estável** — e, na exportação, a tradução de relatório para linhas de CSV.
 *
 * Nenhum relatório expõe identificador de pessoa física: o painel fala em
 * contagem por papel, nunca em lista de usuários; o desempenho fala do anúncio
 * do próprio dono. Quem quiser dado individual usa a rota da entidade, que
 * grava `logs_acesso_dado`.
 */

const exportacao = (item) =>
  item && {
    id: item.id,
    nome: item.nome,
    mime: item.mime,
    tamanhoBytes: item.tamanhoBytes,
    geradoEm: item.geradoEm,
    /* o link já vem assinado e com validade — nunca devolvemos o caminho
       do arquivo no storage, que seria acesso permanente e sem dono */
    download: item.link,
  };

/** escape de CSV: aspas dobradas e campo entre aspas quando há separador */
function celula(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);

  /* prefixo com apóstrofo em texto que começa por = + - @: é o que impede
     CSV injection quando a cliente abre o arquivo no Excel e uma célula vira
     fórmula executável */
  const seguro = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;

  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/**
 * Monta o CSV.
 *
 * Separador `;` e BOM UTF-8 porque o destino real é o Excel em português: com
 * vírgula, a planilha joga a linha inteira numa célula só, e sem BOM os
 * acentos viram caracteres estranhos. Um relatório que a cliente não consegue
 * abrir não é um relatório.
 */
function paraCsv(cabecalho, linhas) {
  const corpo = [cabecalho.map(celula).join(';')];
  linhas.forEach((linha) => corpo.push(linha.map(celula).join(';')));
  return `﻿${corpo.join('\r\n')}\r\n`;
}

/**
 * Achata cada relatório em (cabeçalho, linhas).
 *
 * O painel vira uma tabela `secao · item · valor` em vez de várias planilhas:
 * um CSV com múltiplas tabelas empilhadas é ilegível em qualquer ferramenta, e
 * um ZIP com vários arquivos seria complexidade que ninguém pediu.
 */
const paraLinhas = {
  painel: (dados) => {
    const linhas = [];
    const empurrar = (secao, item, valor) => linhas.push([secao, item, valor]);

    empurrar('usuarios', 'novos no período', dados.usuarios.novos);
    empurrar('usuarios', 'total na plataforma', dados.usuarios.total);
    dados.usuarios.porPapel.forEach((item) => empurrar('usuarios por papel', item.nome, item.total));

    empurrar('anuncios', 'criados no período', dados.anuncios.criados);
    dados.anuncios.porStatus.forEach((item) => empurrar('anuncios por status', item.status, item.total));
    dados.anuncios.porCategoria.forEach((item) => empurrar('anuncios por categoria', item.categoria, item.total));

    empurrar('conversas', 'iniciadas', dados.conversas.iniciadas);
    dados.contatos.porCanal.forEach((item) => empurrar('contatos por canal', item.canal, item.total));

    empurrar('buscas', 'total', dados.buscas.total);
    dados.buscas.semResultado.forEach((item) => empurrar('buscas sem resultado', item.termo, item.total));
    empurrar('buscas sem resultado', '(recortes ocultados por agregação mínima)', dados.buscas.semResultadoOcultados);

    return { cabecalho: ['secao', 'item', 'valor'], linhas };
  },

  desempenho: (dados) => ({
    cabecalho: ['anuncio', 'status', 'visualizacoes', 'visualizacoes_unicas', 'cliques_whatsapp', 'conversas_iniciadas', 'favoritos', 'compartilhamentos'],
    linhas: dados.porAnuncio.map((item) => [
      item.titulo,
      item.status,
      item.visualizacoes,
      item.visualizacoes_unicas,
      item.cliques_whatsapp,
      item.conversas_iniciadas,
      item.favoritos,
      item.compartilhamentos,
    ]),
  }),

  busca: (dados) => ({
    cabecalho: ['tipo', 'termo', 'total', 'sem_resultado'],
    linhas: [
      ...dados.termosMaisBuscados.map((item) => ['mais buscado', item.termo, item.total, item.semResultado]),
      ...dados.termosSemResultado.map((item) => ['sem resultado', item.termo, item.total, item.total]),
      ...dados.filtros.porFiltro.map((item) => ['filtro usado', item.filtro, item.total, '']),
    ],
  }),
};

module.exports = { exportacao, paraCsv, paraLinhas, celula };
