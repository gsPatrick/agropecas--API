'use strict';

/**
 * Config central. Nenhum outro arquivo lê process.env diretamente — assim
 * dá para saber, num lugar só, tudo que o sistema precisa do ambiente.
 *
 * O `.env` é carregado AQUI, não só no `app.js`: script de manutenção, seed e
 * teste também precisam do ambiente, e depender de quem chamou primeiro fazia
 * o mesmo código enxergar configurações diferentes conforme o ponto de entrada.
 * `dotenv` não sobrescreve variável já definida, então o ambiente real do
 * servidor continua vencendo.
 */
require('dotenv').config();

const obrigatoria = (chave, padrao) => {
  const valor = process.env[chave] ?? padrao;
  if (valor === undefined) throw new Error(`Variável de ambiente ausente: ${chave}`);
  return valor;
};

const booleana = (valor, padrao = false) => {
  if (valor === undefined) return padrao;
  return ['1', 'true', 'sim', 'yes'].includes(String(valor).toLowerCase());
};

const producao = (process.env.NODE_ENV || 'development') === 'production';

/**
 * Segredo com padrão só fora de produção.
 *
 * Subir com o segredo de exemplo é o tipo de falha que não dá sintoma: tudo
 * funciona, e qualquer pessoa que leia o repositório assina um token de
 * administrador. Melhor a aplicação recusar-se a subir.
 */
const segredo = (chave, padraoDev) => {
  const valor = process.env[chave];
  if (valor) return valor;
  if (producao) throw new Error(`Variável obrigatória em produção ausente: ${chave}`);
  return padraoDev;
};

module.exports = {
  app: {
    env: process.env.NODE_ENV || 'development',
    port: Number(process.env.APP_PORT || 3333),
    apiPrefix: process.env.APP_API_PREFIX || '/api',
    url: process.env.APP_URL || 'http://localhost:3333',
    webUrl: process.env.APP_WEB_URL || 'http://localhost:3000',
  },

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    name: process.env.DB_NAME || 'agropecas',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: booleana(process.env.DB_SSL),
    logging: booleana(process.env.DB_LOGGING),
    pool: {
      max: Number(process.env.DB_POOL_MAX || 10),
      min: Number(process.env.DB_POOL_MIN || 0),
    },
  },

  seguranca: {
    ipSalt: segredo('SECURITY_IP_SALT', 'sal-de-desenvolvimento'),
    jwtSecret: segredo('JWT_SECRET', 'segredo-de-desenvolvimento'),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
    corsOrigens: (process.env.CORS_ORIGENS || '*')
      .split(',')
      .map((origem) => origem.trim())
      .filter(Boolean),
  },

  auth: {
    /* janela curta no código de e-mail: OTP é enviado por canal que pode ficar
       aberto no aparelho do usuário, então validade longa é risco sem ganho */
    otpDigitos: Number(process.env.AUTH_OTP_DIGITOS || 6),
    otpMinutos: Number(process.env.AUTH_OTP_MINUTOS || 15),
    verificacaoEmailHoras: Number(process.env.AUTH_VERIFICACAO_EMAIL_HORAS || 24),

    /* bloqueio por tentativas: trava a conta, não o IP — bloquear IP derruba
       uma cidade inteira atrás do mesmo NAT rural */
    maxTentativas: Number(process.env.AUTH_MAX_TENTATIVAS || 5),
    janelaTentativasMinutos: Number(process.env.AUTH_JANELA_TENTATIVAS_MINUTOS || 15),
    bloqueioMinutos: Number(process.env.AUTH_BLOQUEIO_MINUTOS || 30),

    maxSessoesPorUsuario: Number(process.env.AUTH_MAX_SESSOES || 10),
    exigirEmailVerificado: booleana(process.env.AUTH_EXIGIR_EMAIL_VERIFICADO, false),
  },

  redis: {
    /* ausente = modo sem infraestrutura: cache em memória, fila na hora */
    url: process.env.REDIS_URL || null,
    prefixo: process.env.REDIS_PREFIXO || 'agropecas',
  },

  cache: {
    ativo: booleana(process.env.CACHE_ATIVO, true),
    /* TTL curto por padrão: dado errado em cache é pior que consulta a mais */
    ttlPadraoSegundos: Number(process.env.CACHE_TTL_PADRAO || 60),
  },

  filas: {
    /* sem Redis o job roda no próprio request; em produção isso seria
       inaceitável, então `producao && !redis` é avisado no boot */
    tentativas: Number(process.env.FILAS_TENTATIVAS || 3),
    esperaInicialMs: Number(process.env.FILAS_ESPERA_INICIAL_MS || 5000),
    concorrencia: Number(process.env.FILAS_CONCORRENCIA || 5),
    manterConcluidos: Number(process.env.FILAS_MANTER_CONCLUIDOS || 500),
    manterFalhados: Number(process.env.FILAS_MANTER_FALHADOS || 5000),
  },

  tempoReal: {
    ativo: booleana(process.env.WS_ATIVO, true),
    /* eventos de digitação são barulhentos: limitar evita que um teclado
       rápido vire centenas de mensagens por minuto no barramento */
    intervaloDigitandoMs: Number(process.env.WS_INTERVALO_DIGITANDO_MS || 2000),
  },

  integracoes: {
    viacepBaseUrl: process.env.VIACEP_BASE_URL || 'https://viacep.com.br/ws',
    geocodeBaseUrl:
      process.env.GEOCODE_BASE_URL || 'https://api.bigdatacloud.net/data/reverse-geocode-client',
  },

  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',
    localPath: process.env.STORAGE_LOCAL_PATH || './uploads',
    publicUrl: process.env.STORAGE_PUBLIC_URL || 'http://localhost:3333/uploads',
  },

  midia: {
    /* 8MB cobre foto de celular moderno sem recorte; acima disso é quase
       sempre print de tela em PNG ou arquivo de câmera profissional, que não
       melhora anúncio nenhum e só custa banda de quem envia */
    maxBytesPorArquivo: Number(process.env.MIDIA_MAX_BYTES || 8 * 1024 * 1024),
    maxArquivosPorRequisicao: Number(process.env.MIDIA_MAX_ARQUIVOS || 10),

    /* bomba de descompressão: 100 megapixels cabem em 50KB de PNG e estouram
       a memória do worker ao decodificar. O teto é conferido pelo cabeçalho
       da imagem ANTES de qualquer decodificação, e repetido no `sharp` */
    maxPixels: Number(process.env.MIDIA_MAX_PIXELS || 40_000_000),
    maxDimensao: Number(process.env.MIDIA_MAX_DIMENSAO || 12_000),

    /* upload que ninguém vinculou a anúncio/perfil neste prazo é lixo: o
       usuário desistiu do formulário. A remoção é em duas etapas (marca,
       depois apaga) para dar margem a um formulário demorado */
    orfaoHoras: Number(process.env.MIDIA_ORFAO_HORAS || 24),
    orfaoCarenciaHoras: Number(process.env.MIDIA_ORFAO_CARENCIA_HORAS || 24),
    orfaosPorRodada: Number(process.env.MIDIA_ORFAOS_POR_RODADA || 200),
  },

  lgpd: {
    retencaoDias: Number(process.env.LGPD_RETENCAO_DIAS || 180),
    encarregadoEmail: process.env.LGPD_ENCARREGADO_EMAIL || 'contato@agropecasmt.com.br',
  },

  obrigatoria,
};
