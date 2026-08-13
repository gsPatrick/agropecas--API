'use strict';

/**
 * Documentos legais versão 1.0 — Termos de Uso, Política de Privacidade e
 * Política de Cookies.
 *
 * Por que isto é seeder e não conteúdo escrito no front: a LGPD e o CDC pedem
 * que se saiba **a que texto** cada pessoa disse sim. Isso só existe se o
 * documento tiver versão e hash no banco (`documentos_legais`), que é a linha
 * para onde o consentimento aponta. Texto cravado em JSX não tem versão: muda
 * no deploy e leva junto a prova do que foi aceito.
 *
 * Sem estas três linhas, `GET /lgpd/documentos` devolve lista vazia e o fluxo
 * de aceite do cadastro não tem o que apresentar.
 *
 * **Formato do `conteudo`**: Markdown mínimo e deliberadamente pobre —
 * `## Título` abre seção, linha solta é parágrafo, linha com `- ` é item de
 * lista. Nada mais é interpretado. O front converte isso na mesma estrutura de
 * seções que já renderiza, sem precisar de biblioteca de Markdown e sem
 * `dangerouslySetInnerHTML` — texto vindo do banco nunca vira HTML.
 *
 * **Idempotente por (tipo, versão)**: rodar duas vezes não duplica nem
 * sobrescreve. Se a administração publicar a 1.1 pela tela de admin, este
 * seeder continua sem efeito.
 */

/* os modelos não usam `underscored`: os nomes de coluna vão em snake_case */
const db = require('../src/models');
const { sha256 } = require('../src/utils/hash');

const TERMOS_DE_USO = `## 1. O que é a AgroPeças MT
A AgroPeças MT é uma plataforma de conexão e divulgação. Ela aproxima produtores rurais, lojas de peças e prestadores de serviços do agronegócio em Mato Grosso, permitindo que publiquem anúncios e encontrem quem procuram.
A plataforma não vende, não intermedeia e não participa das negociações. Não há pagamento processado pelo site, carrinho de compras, frete, garantia de produto ou custódia de valores. Encontrado o anúncio, o contato e toda a negociação acontecem diretamente entre as partes, preferencialmente por WhatsApp.

## 2. Cadastro e conta
Para publicar anúncios é necessário criar uma conta informando dados verdadeiros, completos e atualizados. Cada usuário escolhe seu perfil no cadastro: Produtor Rural, Loja de Peças ou Prestador de Serviços.
O usuário é o único responsável por sua senha e por tudo o que for feito na sua conta. Ao identificar uso indevido, deve comunicar a plataforma imediatamente.
É proibido criar contas com dados de terceiros, usar identidade falsa ou manter mais de uma conta com a intenção de burlar restrições.

## 3. Anúncios e conteúdo do usuário
O conteúdo de cada anúncio — textos, fotos, preços, condições e dados de contato — é de responsabilidade exclusiva de quem o publica. A AgroPeças MT não confere, não valida e não garante a veracidade, a procedência, a qualidade ou a legalidade do que é anunciado.
Ao publicar, o usuário declara que tem direito sobre o item ou serviço anunciado e sobre as imagens enviadas, e autoriza a exibição desse conteúdo na plataforma.
É proibido anunciar:
- itens de origem ilícita, furtados, receptados ou com numeração adulterada;
- produtos falsificados ou que violem marca, patente ou direito autoral;
- armas, munições, agrotóxicos de uso restrito e demais itens de comércio proibido ou controlado sem a devida autorização;
- conteúdo falso, enganoso, ofensivo, discriminatório ou que exponha terceiros;
- anúncios repetidos em massa, propaganda de terceiros ou qualquer forma de spam.

## 4. Contato entre usuários
Ao publicar um anúncio, o usuário autoriza a exibição do seu número de WhatsApp e demais contatos informados, para que interessados possam procurá-lo. Essa exibição é a finalidade central da plataforma.
O contato deve ser respeitoso e restrito ao assunto do anúncio. É vedado usar os contatos obtidos para envio de propaganda não solicitada, cobrança indevida, assédio ou qualquer forma de abuso.

## 5. Moderação
A administração da plataforma pode, a qualquer momento e a seu critério, editar, ocultar ou excluir anúncios, bem como advertir, bloquear ou excluir contas que violem estes termos, prejudiquem outros usuários ou comprometam a segurança do serviço.
A administração também pode intervir em cadastros e anúncios para correção de dados, organização de categorias e manutenção da plataforma. Toda intervenção fica registrada.
As conversas trocadas dentro da plataforma não são lidas de forma rotineira. Havendo denúncia de golpe, fraude, assédio, ameaça ou venda de item proibido, a administração pode acessar e ler o conteúdo da conversa denunciada, no limite necessário para apurar o caso, decidir sobre a denúncia e, quando for o caso, atender determinação de autoridade competente.

## 6. Limitação de responsabilidade
A AgroPeças MT não é parte nos negócios celebrados entre usuários e não responde por eles. Não respondemos por prejuízo decorrente de negociação frustrada, produto com defeito, peça incompatível, serviço mal executado, atraso, inadimplemento ou informação incorreta prestada por qualquer usuário.
A plataforma é oferecida no estado em que se encontra. Não garantimos disponibilidade ininterrupta e podemos suspender o serviço para manutenção ou por motivo técnico.
Recomendamos conferir a procedência do item, a compatibilidade da peça e a idoneidade da outra parte antes de fechar qualquer negócio, preferindo negociações presenciais e documentadas.

## 7. Dados pessoais
Os dados informados no cadastro são usados para identificar o usuário, viabilizar a publicação dos anúncios e permitir o contato entre as partes, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).
Dados de contato marcados para exibição ficam visíveis publicamente nos anúncios — é isso que permite que alguém entre em contato. O usuário pode, a qualquer momento, editar seus dados, ocultar seus anúncios ou solicitar a exclusão da conta.
Não vendemos dados pessoais a terceiros. O tratamento completo está descrito na Política de Privacidade, que integra estes termos.

## 8. Uso gratuito
Nesta fase, o cadastro e a publicação de anúncios são gratuitos. Não há mensalidade nem comissão sobre negócios fechados.
Eventuais planos ou serviços pagos que venham a existir serão comunicados com antecedência e não afetarão retroativamente o que já foi publicado.

## 9. Alterações destes termos
Estes termos podem ser atualizados a qualquer momento. A versão vigente é sempre a publicada nesta página, com a data de atualização indicada. Alterações relevantes são comunicadas e podem exigir novo aceite. O uso da plataforma após a alteração significa concordância com a nova versão.

## 10. Foro
Aplica-se a legislação brasileira. Fica eleito o foro da comarca de Tangará da Serra, Mato Grosso, para dirimir questões decorrentes destes termos, ressalvado o direito do consumidor de acionar o foro de seu domicílio.`;

const POLITICA_PRIVACIDADE = `## 1. Quem trata seus dados
A AgroPeças MT é a controladora dos dados pessoais tratados na plataforma, nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018). Dúvidas, pedidos e reclamações sobre dados pessoais podem ser enviados para contato@agropecasmt.com.br, canal que também atende o Encarregado pelo Tratamento de Dados (DPO).

## 2. Quais dados coletamos
Coletamos apenas o necessário para colocar no ar um classificado de peças e serviços agrícolas em Mato Grosso:
- dados de cadastro: nome ou razão social, CPF ou CNPJ quando aplicável, e-mail, telefone e senha (guardada apenas como hash, nunca em texto legível);
- dados de perfil: tipo de conta (Produtor Rural, Loja de Peças ou Prestador de Serviços), município e estado, descrição da atividade, foto ou logo;
- dados dos anúncios: título, descrição, categoria, marca, estado de conservação, preço, fotos e localização aproximada do item;
- dados de contato para exibição: WhatsApp e demais formas de contato que o próprio usuário escolhe publicar;
- conteúdo de conversas e mensagens trocadas dentro da plataforma;
- dados técnicos de uso: endereço IP, data e hora de acesso, tipo de navegador e páginas visitadas, usados para segurança e prevenção a fraude.
Não coletamos dados sensíveis e não pedimos dados de cartão, porque não processamos pagamentos.

## 3. Para que usamos
Cada dado tem uma finalidade declarada:
- criar e manter sua conta, autenticar o acesso e recuperar senha;
- publicar seus anúncios e permitir que outros usuários os encontrem por busca, categoria e município;
- exibir os contatos que você marcou como públicos, para que interessados possam falar com você — esta é a finalidade central do serviço;
- permitir a troca de mensagens entre usuários;
- moderar conteúdo, apurar denúncias e prevenir fraude, golpe e uso abusivo;
- cumprir obrigações legais e atender determinações de autoridades competentes;
- enviar comunicações operacionais sobre sua conta e seus anúncios.

## 4. Bases legais
Tratamos dados de cadastro, anúncios e mensagens para a execução do contrato de uso da plataforma (art. 7º, V, da LGPD). Registros de acesso e medidas antifraude apoiam-se no cumprimento de obrigação legal (art. 7º, II) e no legítimo interesse em manter o serviço seguro (art. 7º, IX). Comunicações promocionais, quando existirem, dependem do seu consentimento (art. 7º, I), que pode ser revogado a qualquer momento.

## 5. Conversas e denúncias
As mensagens trocadas na plataforma são privadas entre os participantes e não são lidas de forma rotineira, nem usadas para publicidade.
Diante de denúncia de golpe, fraude, assédio, ameaça, discriminação ou oferta de item proibido, a administração pode acessar e ler o conteúdo da conversa denunciada. O acesso é restrito ao necessário para apurar o caso, fica registrado em log de auditoria e pode subsidiar advertência, bloqueio da conta ou resposta a requisição judicial ou de autoridade policial.

## 6. Com quem compartilhamos
Não vendemos, não alugamos e não cedemos dados pessoais para terceiros fazerem marketing.
Os dados que você marca como públicos no anúncio ficam visíveis para qualquer visitante do site — inclusive para mecanismos de busca. Além disso, compartilhamos dados apenas com prestadores que sustentam a operação (hospedagem, envio de e-mail e armazenamento de imagens), que atuam sob nossa instrução, e com autoridades públicas quando houver obrigação legal ou ordem judicial.

## 7. Por quanto tempo guardamos
Dados de cadastro e anúncios permanecem enquanto a conta existir. Encerrada a conta, os registros de acesso são mantidos por 6 meses, conforme o Marco Civil da Internet, e os dados necessários à defesa em processo ou ao cumprimento de obrigação legal pelo prazo aplicável. Vencidos esses prazos, os dados são apagados ou anonimizados de forma irreversível.

## 8. Seus direitos
Conforme o art. 18 da LGPD, você pode solicitar a qualquer momento:
- confirmação de que tratamos seus dados e acesso a eles;
- correção de dados incompletos, inexatos ou desatualizados;
- anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade;
- portabilidade e exportação dos seus dados em formato legível;
- informação sobre com quem compartilhamos seus dados;
- revogação do consentimento, quando esta for a base legal do tratamento.
Boa parte disso está disponível direto na sua conta, em Configurações. Os demais pedidos são atendidos pelo e-mail contato@agropecasmt.com.br, com resposta no menor prazo possível.

## 9. Segurança
Senhas são guardadas apenas como hash, o acesso administrativo é restrito por permissão e registrado em auditoria, e o tráfego do site é criptografado. Nenhum sistema é imune a incidentes: havendo violação de dados com risco relevante, comunicaremos os titulares afetados e a Autoridade Nacional de Proteção de Dados.

## 10. Menores de idade
A plataforma é destinada a maiores de 18 anos. Não coletamos intencionalmente dados de crianças e adolescentes; identificado um cadastro nessa condição, a conta é encerrada e os dados eliminados.

## 11. Alterações desta política
Esta política pode ser atualizada. A versão vigente é sempre a publicada nesta página, com número de versão e data. Mudanças relevantes são comunicadas e podem exigir novo aceite antes de continuar usando a plataforma.`;

const POLITICA_COOKIES = `## 1. O que são cookies
Cookies são pequenos arquivos que o site grava no seu navegador para lembrar informações entre uma página e outra. Também usamos tecnologias equivalentes de armazenamento local (localStorage), que funcionam da mesma forma para os fins desta política.

## 2. Quais cookies usamos
A AgroPeças MT usa o mínimo necessário para o site funcionar:
- essenciais: mantêm você conectado após o login, guardam o token da sessão e protegem formulários contra uso indevido. Sem eles, não é possível entrar na conta nem publicar anúncio;
- de preferência: lembram escolhas suas, como município padrão da busca, filtros recentes e o aviso de cookies já aceito;
- de segurança: ajudam a identificar acessos suspeitos, tentativas repetidas de login e uso automatizado abusivo;
- de medição: contam visitas e páginas mais acessadas de forma agregada, para entender o que a plataforma precisa melhorar.
Não usamos cookies de publicidade comportamental e não montamos perfil de usuário para vender anúncio.

## 3. Cookies de terceiros
Alguns recursos externos, como mapas, vídeos ou botões de contato, podem gravar cookies próprios quando exibidos. Esse tratamento segue a política do respectivo fornecedor, sobre a qual não temos controle.

## 4. Como gerenciar
Você pode aceitar, recusar ou apagar cookies nas configurações do seu navegador, e revisar sua escolha a qualquer momento no aviso exibido no rodapé do site. Recusar cookies essenciais impede o login e a publicação de anúncios; recusar os demais apenas torna a navegação menos conveniente.

## 5. Base legal e prazos
Cookies essenciais e de segurança apoiam-se na execução do contrato e no legítimo interesse em manter o serviço no ar (art. 7º, V e IX, da LGPD). Cookies de preferência e de medição dependem do seu consentimento (art. 7º, I). Cookies de sessão expiram ao fechar o navegador; os demais duram no máximo 12 meses, quando são renovados ou descartados.

## 6. Relação com a Política de Privacidade
Os dados coletados por cookies seguem as mesmas regras de finalidade, compartilhamento, prazo e direitos do titular descritas na Política de Privacidade, que faz parte deste documento. Dúvidas podem ser enviadas para contato@agropecasmt.com.br.`;

const DOCUMENTOS = [
  {
    tipo: 'termos_de_uso',
    titulo: 'Termos de Uso',
    conteudo: TERMOS_DE_USO,
  },
  {
    tipo: 'politica_privacidade',
    titulo: 'Política de Privacidade',
    conteudo: POLITICA_PRIVACIDADE,
  },
  {
    tipo: 'politica_cookies',
    titulo: 'Política de Cookies',
    conteudo: POLITICA_COOKIES,
  },
];

module.exports = {
  async up() {
    /* `vigente_de` = agora, e não uma data fixa no passado: o service escolhe o
       documento vigente pela data mais recente. Uma data antiga faria a 1.0
       perder para qualquer rascunho que já esteja no banco — e a tela pública
       mostraria o rascunho. */
    const agora = new Date();

    for (const documento of DOCUMENTOS) {
      const conteudo = documento.conteudo.trim();

      /* o hash é o que prova, depois, que o texto aceito é o texto no ar.
         Calculado sobre o conteúdo já normalizado para não mudar por espaço. */
      const [, criado] = await db.DocumentoLegal.findOrCreate({
        where: { tipo: documento.tipo, versao: '1.0' },
        defaults: {
          tipo: documento.tipo,
          versao: '1.0',
          titulo: documento.titulo,
          conteudo,
          resumo_mudancas: 'Versão inicial publicada com o lançamento da plataforma.',
          hash_conteudo: sha256(conteudo),
          vigente_de: agora,
          vigente_ate: null,
          /* primeira versão: ninguém aceitou nada antes, não há o que reaceitar */
          exige_novo_aceite: false,
          publicado_por: null,
        },
      });

      console.log(`[seed] ${documento.tipo} 1.0: ${criado ? 'criado' : 'já existia'}`);
    }
  },

  /**
   * O `down` remove só as três linhas em versão 1.0.
   *
   * Apagar a tabela inteira levaria junto versões publicadas pela administração
   * — e, com elas, a referência dos consentimentos já registrados.
   */
  async down() {
    await db.DocumentoLegal.destroy({
      where: { tipo: DOCUMENTOS.map((documento) => documento.tipo), versao: '1.0' },
      force: true,
    });
  },
};
