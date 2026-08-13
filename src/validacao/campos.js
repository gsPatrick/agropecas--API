'use strict';

/**
 * Vocabulário de validação do AgroPeças.
 *
 * Produz ESPECIFICAÇÃO NEUTRA — objetos simples, sem nenhuma biblioteca
 * envolvida. É o que permite trocar o motor de validação sem reescrever as
 * features:
 *
 *   campos.email().obrigatorio()
 *   → { tipo: 'email', obrigatorio: true, regras: [], transformacoes: [...] }
 *
 * O construtor é fluente e imutável: cada chamada devolve uma cópia, então
 * guardar `const nome = campos.texto().min(2)` e reaproveitar em vários
 * esquemas não vaza estado de um para o outro.
 */

class Campo {
  constructor(especificacao) {
    this.spec = {
      tipo: 'qualquer',
      obrigatorio: false,
      permiteNulo: false,
      padrao: undefined,
      rotulo: undefined,
      mensagem: undefined,
      regras: [],
      transformacoes: [],
      ...especificacao,
    };
  }

  /* cópia a cada passo: esquemas que compartilham um campo base não se afetam */
  _derivar(mudancas) {
    return new Campo({
      ...this.spec,
      ...mudancas,
      regras: [...this.spec.regras, ...(mudancas.regras || [])],
      transformacoes: [...this.spec.transformacoes, ...(mudancas.transformacoes || [])],
    });
  }

  _regra(nome, valor, mensagem) {
    return this._derivar({ regras: [{ nome, valor, mensagem }] });
  }

  // ── presença ────────────────────────────────────────────────
  obrigatorio(mensagem) {
    return this._derivar({ obrigatorio: true, mensagemObrigatorio: mensagem });
  }

  opcional() {
    return this._derivar({ obrigatorio: false });
  }

  /** aceita `null` explícito — diferente de ausente */
  permitindoNulo() {
    return this._derivar({ permiteNulo: true });
  }

  padrao(valor) {
    return this._derivar({ padrao: valor });
  }

  /** nome amigável do campo nas mensagens automáticas */
  rotulo(texto) {
    return this._derivar({ rotulo: texto });
  }

  // ── tamanho e faixa ─────────────────────────────────────────
  min(valor, mensagem) {
    return this._regra('min', valor, mensagem);
  }

  max(valor, mensagem) {
    return this._regra('max', valor, mensagem);
  }

  tamanho(valor, mensagem) {
    return this._regra('tamanho', valor, mensagem);
  }

  padraoTexto(expressao, mensagem) {
    return this._regra('regex', expressao, mensagem);
  }

  // ── domínio ─────────────────────────────────────────────────
  /** CPF ou CNPJ, com dígito verificador conferido */
  documentoValido(mensagem) {
    return this._regra('documento', true, mensagem);
  }

  /** telefone brasileiro com DDD, convertido para E.164 */
  telefoneValido(mensagem) {
    return this._regra('telefone', true, mensagem);
  }

  cepValido(mensagem) {
    return this._regra('cep', true, mensagem);
  }

  /** precisa ser exatamente `true` — aceite de termos, por exemplo */
  aceito(mensagem) {
    return this._regra('aceito', true, mensagem);
  }

  igualA(outroCampo, mensagem) {
    return this._regra('igualA', outroCampo, mensagem);
  }

  /** regra livre: recebe (valor, corpo) e devolve mensagem de erro ou null */
  regraPersonalizada(fn, mensagem) {
    return this._regra('personalizada', fn, mensagem);
  }

  // ── transformações (aplicadas ANTES das regras) ─────────────
  aparado() {
    return this._derivar({ transformacoes: ['aparar'] });
  }

  minusculo() {
    return this._derivar({ transformacoes: ['minusculas'] });
  }

  somenteDigitos() {
    return this._derivar({ transformacoes: ['somenteDigitos'] });
  }

  comoE164() {
    return this._derivar({ transformacoes: ['e164'] });
  }
}

const criar = (tipo, extras = {}) => new Campo({ tipo, ...extras });

/**
 * Os tipos. Cada um já vem com as transformações que sempre fazem sentido —
 * e-mail sempre aparado e em minúsculas, por exemplo, porque deixar isso a
 * cargo de quem escreve o esquema garante que um dia alguém esqueça.
 */
const campos = {
  texto: () => criar('texto', { transformacoes: ['aparar'] }),

  textoLongo: () => criar('texto'),

  email: () => criar('email', { transformacoes: ['aparar', 'minusculas'] }),

  senha: () => criar('texto'), // senha NUNCA é aparada: espaço é caractere válido

  numero: () => criar('numero'),

  inteiro: () => criar('inteiro'),

  booleano: () => criar('booleano'),

  data: () => criar('data'),

  uuid: () => criar('uuid'),

  /** valor dentro de uma lista fechada — os enums dos models entram aqui */
  umDe: (opcoes) => criar('enum', { opcoes }),

  telefone: () => criar('texto', { transformacoes: ['aparar'], regras: [{ nome: 'telefone', valor: true }] }),

  /* guarda só dígitos: é como o banco armazena, e comparar "529.982.247-25"
     com "52998224725" seria um bug esperando acontecer */
  documento: () =>
    criar('texto', {
      transformacoes: ['aparar', 'somenteDigitos'],
      regras: [{ nome: 'documento', valor: true }],
    }),

  cep: () =>
    criar('texto', { transformacoes: ['somenteDigitos'], regras: [{ nome: 'cep', valor: true }] }),

  lista: (itemCampo) => criar('lista', { itens: itemCampo }),

  objeto: (definicao) => criar('objeto', { campos: definicao }),

  /** escapatória consciente: aceita qualquer coisa, use com parcimônia */
  livre: () => criar('qualquer'),
};

module.exports = { campos, Campo };
