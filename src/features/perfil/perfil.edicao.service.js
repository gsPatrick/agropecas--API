'use strict';

const db = require('../../models');
const { exigir, pode } = require('../../rbac');
const { erros } = require('../../utils/erros');
const auditoria = require('../auditoria/auditoria.service');
const cachePerfil = require('./perfil.cache');
const enderecoService = require('./perfil.endereco.service');
const {
  CAMPOS_COMUNS,
  CAMPOS_POR_TIPO,
  CAMPOS_BLOQUEADOS,
  COLECOES_NO_PATCH,
} = require('./perfil.constants');

/* os sincronizadores das coleções que chegam no mesmo PATCH. Um mapa e não
   três `if`: o dia em que entrar a quarta coleção, só esta linha muda */
const SINCRONIZADORES = {
  cultura: require('./perfil.cultura.service'),
  maquina: require('./perfil.maquina.service'),
  servico: require('./perfil.servico.service'),
};

/**
 * Edição do perfil.
 *
 * Três garantias, nesta ordem:
 *
 * 1. **Escopo.** `perfil.editar` com escopo `proprio` só passa no próprio
 *    registro; o Admin tem `.todos` e edita qualquer um (Maturacao/05 §2.4).
 *    A checagem é aqui, no service, porque só depois de buscar o perfil se
 *    sabe quem é o dono — middleware não teria essa informação.
 *
 * 2. **Campo do tipo certo.** Os três tipos dividem a mesma tabela com um
 *    discriminador. Sem filtro, um produtor gravaria `inscricao_estadual` e a
 *    loja apareceria com `area_hectares`. O mapa está em `perfil.constants.js`
 *    e o que não pertence ao tipo é **descartado em silêncio**, não recusado:
 *    o front manda o formulário inteiro e recusar seria transformar um detalhe
 *    de implementação em erro de usuário.
 *
 * 3. **Campo que ninguém escreve pelo corpo.** `slug`, `documento`,
 *    `verificado_em`, `verificado_por` e os contadores. O validador já
 *    descarta, mas a segunda barreira existe porque um campo adicionado ao
 *    esquema por descuido não pode virar auto-verificação.
 *
 * O SLUG É IMUTÁVEL — ver `documentacao/features/Perfil.md`.
 */

/** de camelCase do corpo para a coluna do banco */
const PARA_COLUNA = {
  nomeExibicao: 'nome_exibicao',
  bio: 'bio',
  fotoUrl: 'foto_url',
  capaUrl: 'capa_url',
  site: 'site',
  instagram: 'instagram',
  facebook: 'facebook',
  whatsapp: 'whatsapp',
  telefoneSecundario: 'telefone_secundario',
  emailPublico: 'email_publico',
  exibirWhatsapp: 'exibir_whatsapp',
  exibirEnderecoExato: 'exibir_endereco_exato',
  aceitaChat: 'aceita_chat',
  municipioId: 'municipio_id',
  propriedadeNome: 'propriedade_nome',
  areaHectares: 'area_hectares',
  razaoSocial: 'razao_social',
  nomeFantasia: 'nome_fantasia',
  inscricaoEstadual: 'inscricao_estadual',
  entregaObservacao: 'entrega_observacao',
  formasEntrega: 'formas_entrega',
  raioEntregaKm: 'raio_entrega_km',
  prazoRespostaHoras: 'prazo_resposta_horas',
  atendeNoCampo: 'atende_no_campo',
  raioAtendimentoKm: 'raio_atendimento_km',
  formasAtendimento: 'formas_atendimento',
};

/**
 * Traduz o corpo em um patch de colunas, mantendo só o que este tipo de perfil
 * pode ter. Devolve também o que foi ignorado, para a documentação e para o
 * teste conseguirem afirmar que o descarte aconteceu.
 */
function montarPatch(dados, tipo) {
  const permitidos = new Set([...CAMPOS_COMUNS, ...(CAMPOS_POR_TIPO[tipo] || [])]);
  const patch = {};
  const ignorados = [];

  Object.entries(dados || {}).forEach(([chave, valor]) => {
    if (valor === undefined) return;

    /* endereço e coleções vão para outras tabelas (ver `separarColecoes`); sem
       esta linha voltariam como "ignorados" e o front avisaria a pessoa que o
       que ela salvou foi descartado — justamente o contrário do que aconteceu */
    if (chave === 'endereco' || COLECOES_NO_PATCH[chave]) return;

    const coluna = PARA_COLUNA[chave];
    if (!coluna || CAMPOS_BLOQUEADOS.includes(coluna) || !permitidos.has(coluna)) {
      ignorados.push(chave);
      return;
    }
    patch[coluna] = valor;
  });

  return { patch, ignorados };
}

/**
 * Separa do corpo o que NÃO é coluna de `perfis`: as coleções N:N e o bloco de
 * endereço.
 *
 * Elas chegam no mesmo PATCH porque a tela salva o formulário inteiro de uma
 * vez — mas cada uma vai para uma tabela diferente e não pode passar por
 * `montarPatch`, que só sabe traduzir coluna.
 *
 * Coleção mandada por um tipo que não a tem é **descartada em silêncio** e
 * volta em `camposIgnorados`, exatamente como os campos exclusivos de tipo: o
 * front manda o formulário completo, e recusar transformaria um detalhe de
 * implementação em erro de usuário.
 */
function separarColecoes(dados, tipo) {
  const colecoes = {};
  const ignorados = [];

  Object.entries(COLECOES_NO_PATCH).forEach(([nome, definicao]) => {
    if (dados?.[nome] === undefined) return;

    if (definicao.tipos && !definicao.tipos.includes(tipo)) {
      ignorados.push(nome);
      return;
    }

    colecoes[nome] = dados[nome];
  });

  return { colecoes, endereco: dados?.endereco, ignorados };
}

/** município define a UF: deixar o cliente mandar as duas abriria divergência */
async function resolverLocalizacao(patch) {
  if (!('municipio_id' in patch)) return patch;

  if (patch.municipio_id === null) return { ...patch, uf: null };

  const municipio = await db.Municipio.findByPk(patch.municipio_id, {
    attributes: ['id', 'uf'],
  });
  if (!municipio) throw erros.validacao({ municipioId: 'Município não encontrado.' });

  return { ...patch, uf: municipio.uf };
}

/**
 * Aplica a edição.
 *
 * @param perfil   instância já carregada (é quem revela o dono)
 * @param dados    corpo já validado
 */
async function atualizar(perfil, dados, contexto) {
  exigir(contexto, 'perfil.editar', { donoId: perfil.usuario_id });

  const { colecoes, endereco, ignorados: ignoradosColecao } = separarColecoes(dados, perfil.tipo);

  const { patch, ignorados: ignoradosCampo } = montarPatch(dados, perfil.tipo);
  const completo = await resolverLocalizacao(patch);
  const ignorados = [...ignoradosCampo, ...ignoradosColecao];

  const temColecao = Object.keys(colecoes).length > 0 || endereco !== undefined;

  if (!Object.keys(completo).length && !temColecao) {
    throw erros.validacao({ perfil: 'Nenhum campo válido para este tipo de perfil.' });
  }

  /* snapshot só das colunas tocadas: guardar o registro inteiro no `antes`
     encheria a trilha de auditoria de ruído e de dado pessoal repetido */
  const antes = {};
  Object.keys(completo).forEach((coluna) => {
    antes[coluna] = perfil.get(coluna);
  });

  /* UMA transação para campos, endereço e coleções: o PATCH é o "Salvar" da
     tela inteira, e gravar metade dela é o pior resultado possível — a pessoa
     vê a confirmação e volta depois com o cadastro pela metade, sem erro
     nenhum registrado (PADRAO_MODULO §10.6) */
  await db.sequelize.transaction(async (transacao) => {
    if (endereco !== undefined) {
      const registro = await enderecoService.salvar(perfil, endereco, {
        transacao,
        /* o município pode estar mudando neste mesmo PATCH; o endereço tem de
           nascer já com o novo, não com o que estava no registro */
        municipioId:
          'municipio_id' in completo ? completo.municipio_id : perfil.municipio_id,
      });

      /* `endereco_id` é campo bloqueado no corpo de propósito (ninguém aponta o
         perfil para o endereço de outra pessoa); quem escreve é o servidor,
         depois de criar a linha */
      if (registro) completo.endereco_id = registro.id;
    }

    await perfil.update({ ...completo, ultima_atividade_em: new Date() }, { transaction: transacao });

    for (const [nome, valores] of Object.entries(colecoes)) {
      const definicao = COLECOES_NO_PATCH[nome];
      await SINCRONIZADORES[definicao.service].sincronizar(perfil, valores, { transacao });
    }
  });

  await cachePerfil.invalidar(perfil);

  /* auditoria sempre que quem edita não é o dono: é o rastro que o poder amplo
     do Admin exige (Maturacao/05 §2.4). Edição do próprio perfil também entra,
     mas com `em_nome_de` nulo — é o histórico de correção do titular */
  const proprio = String(perfil.usuario_id) === String(contexto?.usuarioId || '');
  await auditoria.registrar(contexto, {
    acao: 'editar',
    entidade: 'perfis',
    entidadeId: perfil.id,
    antes,
    depois: completo,
    emNomeDe: proprio ? null : perfil.usuario_id,
    motivo: proprio ? null : 'edição de perfil de terceiro',
  });

  return { perfil, ignorados };
}

/**
 * Remoção (soft delete — a tabela é `paranoid`).
 *
 * Apagar de verdade levaria junto o histórico de quem negociou com a pessoa; a
 * exclusão definitiva pertence ao fluxo de anonimização da LGPD, no módulo de
 * usuário, não aqui.
 */
async function remover(perfil, { motivo } = {}, contexto) {
  exigir(contexto, 'perfil.remover', { donoId: perfil.usuario_id });

  const slug = perfil.slug;
  await perfil.destroy();
  await cachePerfil.invalidar({ slug });

  await auditoria.registrar(contexto, {
    acao: 'remover',
    entidade: 'perfis',
    entidadeId: perfil.id,
    motivo: motivo || null,
    emNomeDe:
      String(perfil.usuario_id) === String(contexto?.usuarioId || '') ? null : perfil.usuario_id,
  });

  return { removido: true };
}

/** o dono edita o seu; quem tem `.todos` edita o de qualquer um */
const podeEditar = (contexto, perfil) =>
  pode(contexto, 'perfil.editar', { donoId: perfil.usuario_id });

module.exports = { atualizar, remover, montarPatch, separarColecoes, podeEditar };
