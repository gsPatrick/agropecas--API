'use strict';

const { campos, esquema } = require('../../validacao');
const { PEDIDO_STATUS, REPASSE_STATUS, CHAVE_PIX_TIPO } = require('../../models/constantes');
const { MAXIMO_QUANTIDADE, MOTIVO_MAXIMO } = require('./pedido.constants');

/**
 * Entrada da feature.
 *
 * O que NÃO entra pelo corpo, de propósito: preço, comissão, vendedor e
 * comprador. O preço vem do anúncio, a comissão do ambiente e as pessoas do
 * contexto — aceitar `precoCentavos` do front seria deixar o comprador
 * escolher quanto paga.
 */

const checkout = esquema({
  anuncioId: campos.uuid().obrigatorio('Informe o anúncio.'),
  quantidade: campos.inteiro().min(1, 'Quantidade mínima: 1.').max(MAXIMO_QUANTIDADE).padrao(1),
});

const identificador = esquema({ id: campos.uuid().obrigatorio('Identificador inválido.') });

const motivoOpcional = esquema({ motivo: campos.texto().max(MOTIVO_MAXIMO) });

const motivoObrigatorio = esquema({
  motivo: campos.texto().obrigatorio('Conte o que aconteceu.').min(8, 'Descreva com pelo menos 8 caracteres.').max(MOTIVO_MAXIMO),
});

const sincronizar = esquema({
  /* vem da URL de retorno do MP (`payment_id` / `collection_id`) — é só
     uma pista: o status real é reconsultado na API */
  pagamentoId: campos.texto().padraoTexto(/^\d{1,20}$/, 'Pagamento inválido.'),
});

const listar = esquema({
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
  status: campos.umDe(PEDIDO_STATUS),
});

const listarAdmin = esquema({
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
  status: campos.umDe(PEDIDO_STATUS),
  busca: campos.texto().max(80),
  desde: campos.data(),
  ate: campos.data(),
});

const extrato = esquema({
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
  status: campos.umDe(REPASSE_STATUS),
});

const listarRepassesAdmin = esquema({
  pagina: campos.inteiro().min(1),
  porPagina: campos.inteiro().min(1).max(100),
  status: campos.umDe(REPASSE_STATUS),
  vendedorId: campos.uuid(),
});

/** confere o formato da chave conforme o tipo — PIX errado é dinheiro perdido */
const FORMATOS_PIX = {
  cpf: /^\d{11}$/,
  cnpj: /^\d{14}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  telefone: /^\+55\d{10,11}$/,
  aleatoria: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
};

/**
 * Forma canônica da chave: o vendedor digita "123.456.789-09" ou
 * "(65) 99999-8888", e o PIX precisa de dígitos / E.164. A mesma função
 * valida e grava — validar uma forma e gravar outra é como chave "válida"
 * vira PIX recusado no banco.
 */
function normalizarChavePix(tipo, valor) {
  const texto = String(valor || '').trim();
  if (tipo === 'cpf' || tipo === 'cnpj') return texto.replace(/\D/g, '');
  if (tipo === 'email') return texto.toLowerCase();
  if (tipo === 'telefone') {
    const digitos = texto.replace(/\D/g, '');
    return digitos.startsWith('55') && digitos.length >= 12 ? `+${digitos}` : `+55${digitos}`;
  }
  return texto.toLowerCase();
}

const chavePix = esquema({
  chavePixTipo: campos.umDe(CHAVE_PIX_TIPO).obrigatorio('Informe o tipo da chave.'),
  chavePix: campos
    .texto()
    .obrigatorio('Informe a chave PIX.')
    .max(140)
    .regraPersonalizada((valor, corpo) => {
      const formato = FORMATOS_PIX[corpo.chavePixTipo];
      if (!formato || formato.test(normalizarChavePix(corpo.chavePixTipo, valor))) return null;
      return 'A chave não corresponde ao tipo escolhido.';
    }),
});

const pagarRepasse = esquema({
  comprovante: campos.texto().max(255),
  observacao: campos.texto().max(MOTIVO_MAXIMO),
});

module.exports = {
  checkout,
  identificador,
  motivoOpcional,
  motivoObrigatorio,
  sincronizar,
  listar,
  listarAdmin,
  extrato,
  listarRepassesAdmin,
  chavePix,
  pagarRepasse,
  FORMATOS_PIX,
  normalizarChavePix,
};
