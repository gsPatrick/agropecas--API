'use strict';

const { campos, esquema } = require('../../validacao');
const { PERFIL_TIPO, CONSENTIMENTO_TIPO } = require('../../models/constantes');
/* o bloco de endereço é definido na feature de perfil, e importado — o mesmo
   formulário aparece no cadastro e na edição, e duas cópias divergem */
const { enderecoCampos } = require('../perfil/perfil.validators');

/**
 * Esquemas de entrada da feature.
 *
 * Declarados com o vocabulário de `src/validacao` — nenhuma biblioteca de
 * validação aparece aqui, e trocar o motor não toca neste arquivo.
 *
 * Compilados uma vez, no carregamento do módulo, e reaproveitados por todas as
 * requisições.
 */

const SENHA_MINIMA = 8;

const senha = () =>
  campos
    .senha()
    .min(SENHA_MINIMA, `A senha precisa de ao menos ${SENHA_MINIMA} caracteres.`)
    .max(200);

const emailObrigatorio = () => campos.email().obrigatorio('Informe seu e-mail.');
const codigoObrigatorio = () =>
  campos.texto().obrigatorio('Informe o código.').min(4).max(10).somenteDigitos();

const registro = esquema({
  nome: campos.texto().obrigatorio('Informe seu nome.').min(2).max(160),
  email: emailObrigatorio(),
  senha: senha().obrigatorio('Crie uma senha.'),

  telefone: campos.telefone().comoE164(),
  whatsapp: campos.telefone().comoE164(),

  tipoPerfil: campos
    .umDe(PERFIL_TIPO)
    .obrigatorio('Escolha o tipo de perfil.')
    .rotulo('tipo de perfil'),

  nomeExibicao: campos.texto().min(2).max(160),
  documento: campos.documento(),
  razaoSocial: campos.texto().max(180),
  nomeFantasia: campos.texto().max(180),
  inscricaoEstadual: campos.texto().max(30),
  entregaObservacao: campos.textoLongo().max(2000),
  propriedadeNome: campos.texto().max(160),
  areaHectares: campos.numero().min(0),
  atendeNoCampo: campos.booleano(),
  raioAtendimentoKm: campos.inteiro().min(0).max(2000),

  /* o cadastro já pedia o endereço na tela e a API guardava só o município: o
     CEP, o logradouro e o número iam para o lixo, e a pessoa reencontrava os
     campos em branco na primeira edição do perfil */
  municipioId: campos.uuid(),
  endereco: campos.objeto(enderecoCampos),

  aceiteTermos: campos.booleano().aceito('É preciso aceitar os Termos de Uso.'),
  aceitePrivacidade: campos
    .booleano()
    .aceito('É preciso aceitar a Política de Privacidade.'),
  comunicacao_marketing: campos.booleano(),
  exibir_whatsapp: campos.booleano(),
  exibirWhatsapp: campos.booleano(),

  /* o formulário pode mandar a lista pronta em vez dos checkboxes */
  consentimentos: campos.lista(
    campos.objeto({
      tipo: campos.umDe(CONSENTIMENTO_TIPO).obrigatorio(),
      aceito: campos.booleano().padrao(true),
      finalidade: campos.texto().max(300),
    })
  ),
});

const login = esquema({
  email: emailObrigatorio(),
  senha: campos.senha().obrigatorio('Informe sua senha.'),
});

const renovar = esquema({
  refreshToken: campos.texto().min(20, 'Token de renovação inválido.'),
});

const solicitarSenha = esquema({ email: emailObrigatorio() });

const conferirCodigo = esquema({
  email: emailObrigatorio(),
  codigo: codigoObrigatorio(),
});

const redefinirSenha = esquema({
  email: emailObrigatorio(),
  codigo: codigoObrigatorio(),
  senha: senha().obrigatorio('Crie uma senha.'),
});

const trocarSenha = esquema({
  senhaAtual: campos.senha().obrigatorio('Informe a senha atual.'),
  senha: senha().obrigatorio('Crie uma nova senha.'),
});

const confirmarEmail = esquema({
  email: emailObrigatorio(),
  codigo: codigoObrigatorio(),
});

const reenviarCodigo = esquema({ email: emailObrigatorio() });

const atualizarConsentimento = esquema({
  tipo: campos.umDe(CONSENTIMENTO_TIPO).obrigatorio('Informe o tipo de consentimento.'),
  aceito: campos.booleano().obrigatorio('Informe se aceita ou revoga.'),
});

const sairDeTodos = esquema({ manterAtual: campos.booleano().padrao(true) });

const identificador = esquema({ id: campos.uuid().obrigatorio('Identificador inválido.') });

module.exports = {
  SENHA_MINIMA,
  registro,
  login,
  renovar,
  solicitarSenha,
  conferirCodigo,
  redefinirSenha,
  trocarSenha,
  confirmarEmail,
  reenviarCodigo,
  atualizarConsentimento,
  sairDeTodos,
  identificador,
};
