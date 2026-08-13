'use strict';

/**
 * Constantes da mídia. Ficam fora dos services porque limite de upload é o
 * tipo de número que alguém muda sob pressão ("o cliente reclamou que 5MB é
 * pouco") — melhor que exista um lugar só, ao lado do motivo de cada valor.
 */

/**
 * Tipos aceitos, identificados por **assinatura binária** e não por `mimetype`.
 *
 * O `mimetype` que chega no multipart é escrito pelo cliente: dizer
 * `image/jpeg` num arquivo PHP custa uma linha de curl. A extensão idem. O que
 * não mente é o começo do arquivo — por isso a lista abaixo é a fonte de
 * verdade do módulo, e o cabeçalho enviado serve no máximo como filtro barato.
 *
 * SVG está fora de propósito: é XML, aceita `<script>` e `<foreignObject>`, e
 * servido do mesmo domínio vira XSS armazenado. Não há variante segura de
 * "aceitar SVG do usuário" que valha o risco num classificado de peças.
 */
const TIPOS_ACEITOS = [
  {
    mime: 'image/jpeg',
    extensao: 'jpg',
    rotulo: 'JPEG',
    /* SOI + primeiro marcador: FF D8 FF */
    confere: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    extensao: 'png',
    rotulo: 'PNG',
    confere: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    extensao: 'webp',
    rotulo: 'WebP',
    /* contêiner RIFF com o form-type WEBP no offset 8 — só "RIFF" também
       vale para WAV e AVI, então os dois pedaços são conferidos */
    confere: (b) =>
      b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** o que o `accept` do formulário deve declarar */
const MIMES_ACEITOS = TIPOS_ACEITOS.map((tipo) => tipo.mime);

/** campos de arquivo aceitos no multipart — `arquivo` é o atalho de envio único */
const CAMPOS_ARQUIVO = ['arquivos', 'arquivo'];

/**
 * Variantes geradas pelo job.
 *
 * Três tamanhos e nada além: cada variante extra é CPU no worker e espaço no
 * storage para sempre. `thumb` serve a grade de resultados, `media` o card e o
 * carrossel do celular, `grande` a ampliação — que é a única tela onde alguém
 * repara em detalhe de uma peça.
 *
 * Todas saem em WebP porque o peso da imagem é o gargalo real do front no
 * 4G do interior: o mesmo enquadramento sai ~30% menor que o JPEG equivalente.
 * O original fica guardado como veio para que trocar de formato amanhã não
 * exija pedir a foto de novo ao anunciante.
 */
const VARIANTES = [
  { rotulo: 'thumb', largura: 320, qualidade: 78 },
  { rotulo: 'media', largura: 800, qualidade: 80 },
  { rotulo: 'grande', largura: 1600, qualidade: 82 },
];

const ROTULOS_VARIANTE = VARIANTES.map((variante) => variante.rotulo);

/** pastas no storage — nenhum pedaço vem do cliente */
const PASTAS = {
  originais: 'midia/originais',
  variantes: 'midia/variantes',
};

/**
 * `referencia_tipo` reservado para as variantes.
 *
 * A tabela `arquivos` não tem coluna de status nem de metadados, e migration
 * não é deste módulo. A variante entra como linha própria apontando para o
 * original — o que resolve três coisas de uma vez: o inventário continua
 * sabendo de cada byte no disco (é o que permite cumprir exclusão do titular),
 * o job fica idempotente (basta olhar quais rótulos já existem) e o status sai
 * derivado: sem variante = ainda processando.
 */
const REFERENCIA_VARIANTE = 'midia_variante';

/** entidades às quais um upload pode ser vinculado */
const REFERENCIAS = ['anuncio', 'perfil_foto', 'perfil_capa'];

const STATUS = {
  PROCESSANDO: 'processando',
  PRONTO: 'pronto',
};

module.exports = {
  TIPOS_ACEITOS,
  MIMES_ACEITOS,
  CAMPOS_ARQUIVO,
  VARIANTES,
  ROTULOS_VARIANTE,
  PASTAS,
  REFERENCIA_VARIANTE,
  REFERENCIAS,
  STATUS,
};
