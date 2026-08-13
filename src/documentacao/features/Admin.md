# Admin — o painel administrativo

O módulo que a Aline abre para trabalhar. Não é "mais uma feature": é a
superfície onde todas as outras se encontram, agrupadas por **tarefa** e não
por entidade.

---

## 1. Por que a estrutura é diferente das outras features

O `PADRAO_MODULO.md` §1 manda tudo **plano** dentro de
`src/features/<nome>/`. O `admin` é a única exceção do projeto, e ela é
declarada, não acidental:

```
src/features/admin/
  admin.routes.js       mapa do painel inteiro — CONTRATO FECHADO
  admin.validators.js   esquemas de entrada de todas as áreas
  controllers/          um controller por ÁREA da tela
  services/             um service por ASSUNTO dentro da área
  helpers/              auditoria · leitura de filtros · contexto de ação
```

A razão: o painel tem sete áreas (painel, usuários, conteúdo, catálogo,
comunidade, plataforma, conformidade) e cada uma compõe de três a seis
features. Plano, isso seriam trinta e poucos arquivos `admin.*.js` num
diretório só — e a regra de "um service, um assunto" continuaria valendo,
apenas ilegível. As subpastas não escondem regra nenhuma: continuam existindo
`<area>.<assunto>.service.js`, o fluxo continua `routes → controller →
service(s)`, e nenhum service conhece `req`.

`admin.routes.js` é **um arquivo só** de propósito. É a lista completa do que o
Admin pode fazer, numa página que se lê de cima a baixo. Espalhada em sete
routers, a pergunta "o que exige `usuario.banir`?" viraria uma caçada.

---

## 2. Os dois princípios

### Composição, não cópia

Suspender continua sendo `moderacao.usuario.service`. Publicar continua sendo
`anuncio.publicacao.service`. Editar configuração continua sendo
`configuracao.escrita.service.definir`. Atribuir plano continua sendo
`plano.assinatura.service.atribuir`.

O painel **chama**; não reimplementa. Duplicar a regra garantiria que um dia as
duas versões divergissem — e a errada seria justamente a do Admin, que é quem
tem poder para causar o estrago maior.

Consequência prática, visível no código: quando a feature composta já grava
`logs_auditoria` (configuração, plano, LGPD, exportações), o service do painel
**não registra de novo**. Duas linhas para o mesmo fato transformariam o
histórico de uma configuração em uma lista com tudo em dobro. O helper
`admin.auditoria.helper` é usado onde o painel é o dono da operação — o caso do
RBAC pela tela.

### Não cria poder novo

`admin.acessar` abre a porta. Cada operação lá dentro exige a permissão do
**recurso que ela manipula** (`autorizar('plano.criar')`,
`autorizar('auditoria.exportar')`). Um moderador entra no painel e não enxerga
configuração, plano nem RBAC — sem nenhum `if (admin)` no caminho.

O que o painel acrescenta é: **visão agregada**, **ação em lote** e
**representação** (agir em nome de um usuário, com a auditoria registrando quem
de fato agiu).

---

## 3. Endpoints por área

Todas as rotas abaixo ficam sob `/api/v1/admin` e já chegam autenticadas e com
`admin.acessar` verificado.

### Painel

| Método | Rota | Permissão |
|---|---|---|
| GET | `/painel` | `admin.acessar` |
| GET | `/painel/pendencias` | `admin.acessar` |
| GET | `/painel/metricas` | `admin.acessar` |
| GET | `/painel/atividade` | `admin.acessar` |
| GET | `/painel/saude` | `admin.acessar` (somenteAdmin) |

### Usuários e perfis

| Método | Rota | Permissão |
|---|---|---|
| GET | `/usuarios` · `/usuarios/:id` · `/usuarios/:id/atividade` | `usuario.ler` |
| PATCH | `/usuarios/:id` | `usuario.editar` |
| POST | `/usuarios/:id/suspender` · `/banir` · `/restaurar` | `usuario.suspender` · `usuario.banir` · `usuario.restaurar` |
| POST | `/usuarios/:id/encerrar-sessoes` | `usuario.encerrar_sessoes` |
| GET/POST/DELETE | `/usuarios/:id/papeis[/:papel]` | `rbac.ler` · `rbac.atribuir_papel` |
| POST | `/usuarios/lote/sancionar` | `usuario.suspender` + `admin.operar_em_lote` |
| GET | `/perfis` | `perfil.ler` |
| POST/DELETE | `/perfis/:id/verificar` | `perfil.verificar` |

### Conteúdo

| Método | Rota | Permissão |
|---|---|---|
| GET/PATCH/DELETE | `/anuncios[/:id]` | `anuncio.ler` · `anuncio.editar` · `anuncio.remover` |
| GET | `/moderacao/fila` | `anuncio.ler` |
| POST | `/anuncios/:id/aprovar` · `/reprovar` · `/ocultar` · `/destacar` | ação correspondente |
| POST | `/anuncios/em-nome-de` | `anuncio.criar_em_nome_de` |
| POST | `/anuncios/lote/moderar` | `anuncio.aprovar` + `admin.operar_em_lote` |
| POST | `/fotos/:id/bloquear` | `anuncio_foto.bloquear` |
| GET/DELETE | `/midia[/:id]` | `arquivo.remover` |

### Catálogo

| Método | Rota | Permissão |
|---|---|---|
| GET/POST/PATCH/DELETE | `/catalogo/:colecao[/:id]` | `categoria.criar` (porta) + a do item |
| PATCH | `/catalogo/:colecao/ordenar` | idem |

### Comunidade

| Método | Rota | Permissão |
|---|---|---|
| GET | `/denuncias` · `/denuncias/agrupadas` · `/denuncias/:id` | `denuncia.ler` |
| POST | `/denuncias/:id/resolver` | `denuncia.resolver` |
| GET | `/conversas` · `/conversas/:id` | `conversa.ler` (+ motivo obrigatório) |
| DELETE | `/mensagens/:id` | `mensagem.remover` |
| GET/POST | `/comunicados` | `notificacao.enviar` |
| GET/PUT | `/notificacoes/templates[/:id]` | `notificacao.template_editar` |

### Plataforma — configuração, planos, RBAC

| Método | Rota | Permissão |
|---|---|---|
| GET | `/configuracoes` | `configuracao.ler` |
| PUT | `/configuracoes/:chave` | `configuracao.editar` |
| GET | `/configuracoes/:chave/historico` | `configuracao.ler` |
| GET | `/planos` | `plano.ler` |
| POST | `/planos` | `plano.criar` |
| PATCH | `/planos/:id` | `plano.editar` |
| PUT | `/planos/:id/limites` | `plano.editar` |
| DELETE | `/planos/:id` | `plano.remover` |
| POST | `/planos/atribuir` | `plano.atribuir` |
| GET | `/rbac/papeis` · `/rbac/permissoes` | `rbac.ler` |
| POST | `/rbac/papeis` | `rbac.criar_papel` |
| PATCH | `/rbac/papeis/:id` | `rbac.editar_papel` |
| DELETE | `/rbac/papeis/:id` | `rbac.remover_papel` |

### Conformidade — LGPD, auditoria, relatórios

| Método | Rota | Permissão |
|---|---|---|
| GET | `/lgpd/solicitacoes` · `/lgpd/solicitacoes/:id` | `lgpd.ler_solicitacoes` |
| POST | `/lgpd/solicitacoes/:id/responder` | `lgpd.responder_solicitacao` |
| GET/POST | `/lgpd/documentos` | `lgpd.publicar_documento` |
| GET | `/auditoria` | `auditoria.ler` |
| GET | `/auditoria/acessos-a-dados` | `auditoria.ler` |
| POST | `/auditoria/exportar` | `auditoria.exportar` |
| GET | `/relatorios` | `relatorio.ler` |
| POST | `/relatorios/exportar` | `relatorio.exportar` |

**Não existe** `PATCH /auditoria/:id` nem `DELETE /auditoria/:id`. A ausência é
a funcionalidade — ver §5.

---

## 4. Decisões que valem explicação

### 4.1 Leitura de conversa privada

`GET /conversas/:id` entrega ao Admin mensagem trocada entre duas pessoas que
não são ele. É a operação mais invasiva do sistema e ela existe porque a
cliente pediu poder de intervenção. O preço é o rastro:

- **motivo obrigatório** na query (`esquemas.motivoAcesso`, mínimo de 10
  caracteres) — sem motivo escrito não há leitura;
- **`denuncia_id` vinculado** quando existe denúncia sobre aquela conversa;
- **`logs_acesso_dado` por titular**, com motivo e denúncia.

Sem denúncia, a leitura continua possível (o Admin é Admin) e o motivo passa a
ser a única justificativa registrada — é justamente o caso que uma auditoria
deve revisar primeiro.

### 4.2 Ação em nome de terceiro

`POST /anuncios/em-nome-de` existe porque o produtor liga pedindo ajuda e o
Admin cadastra por ele. `helpers/admin.contexto.helper.paraTerceiro` monta o
contexto derivado: **`usuarioId` continua sendo o do Admin** e a representação
viaja em `emNomeDe`. Trocar a identidade faria a auditoria registrar o produtor
como autor de uma ação que não foi dele — que é o oposto do que a trilha serve
para provar.

### 4.3 Ação em lote

Lote exige `admin.operar_em_lote` (permissão própria, não derivada) e tem teto
de 100 registros por operação: ação em massa sem limite é o jeito mais rápido
de um clique errado atingir a base inteira, e não há desfazer. A auditoria
grava **uma linha** com a lista de alvos — uma linha por registro afetado
transformaria "suspendi 80 contas" em 80 entradas idênticas e enterraria
justamente o evento que mais importa revisar.

### 4.4 As travas do RBAC pela tela

`POST/PATCH/DELETE /rbac/papeis` deixam a cliente criar papel e mexer em
permissão **sem deploy**. É a flexibilidade que ela pediu, e é a superfície
mais perigosa do painel: quem edita papel edita quem pode o quê, inclusive a si
mesmo. Cinco invariantes protegem isso
(`services/admin.plataforma.rbac.service.js`):

1. **Papel `sistema: true` não é removido nem tem a chave trocada.** `admin`,
   `moderador`, `suporte` e `usuario` são de sistema. Remover o papel `admin`
   deixaria a plataforma sem dono, sem volta. A chave é o que `temPapel()` e o
   sincronizador usam para reconhecer o papel — trocá-la desliga em silêncio o
   que o deploy reaplica.
2. **Ninguém retira as próprias permissões de administração.** A operação é
   simulada antes de gravar: se, depois da mudança, alguma permissão de
   administração que o ator tem hoje deixar de existir em todos os papéis dele,
   a resposta é 409. Não há caminho de volta pela API — só por SQL.
3. **Nenhum papel recebe permissão que quem concede não tem.** A checagem é por
   chave exata (`temPermissao`), não por `pode()`: conceder
   `anuncio.editar.todos` tendo apenas `.proprio` é exatamente a escalada a
   barrar. Sem essa regra, um moderador com `rbac.editar_papel` se
   autopromoveria a Admin em dois cliques. (Defesa em profundidade: o esquema
   `papelNovo`/`papelEdicao` só aceita o formato `recurso.acao[.escopo]`, então
   o coringa `*` nem chega ao service pela tela.)
4. **Sempre resta pelo menos um usuário com o coringa `*`.** Antes de qualquer
   escrita que possa zerar isso, o service conta os papéis que ainda teriam `*`
   e os usuários vinculados a eles. Zero em qualquer um dos dois → 409.
5. **Toda mudança em papel grava `logs_auditoria`** com `antes` e `depois`
   (permissões incluídas), pelo `helpers/admin.auditoria.helper`.

**Interação com o sincronizador** (`src/rbac/sincronizar.js`): o que é feito
pela tela **sobrevive ao deploy**. O sincronizador é `findOrCreate` puro — cria
o que falta, nunca apaga papel criado na tela nem vínculo concedido à mão, e
permissão que saiu do código é apenas **relatada como obsoleta**, porque
remover automaticamente derrubaria acesso em produção sem aviso. O catálogo do
código é o **piso**; a tela é o teto. A contrapartida honesta: um papel de
sistema **recebe de volta**, no próximo `rbac:sync`, qualquer permissão do
catálogo que tenham tirado por aqui — por isso tirar permissão de papel de
sistema é mudança de código, não de tela.

### 4.5 Configuração sensível não vaza na listagem

A tela do Admin lista todas as configurações de uma vez. Uma tela que imprime
segredo em texto puro vaza por captura de tela, por print no WhatsApp do
suporte e por gravação de sessão — sem nenhuma falha de permissão envolvida.
Chave cujo nome contenha `segredo · secret · senha · token · credencial ·
api_key · webhook · smtp` sai com `valor: null` e `mascarado: true`, na
listagem **e no histórico** (senão o diff entregaria o que a lista escondeu). O
reconhecimento é por padrão no nome, e não por lista fechada: chave nova nasce
protegida sem depender de alguém lembrar de cadastrá-la. A lista branca
`PUBLICAS` da feature `configuracao` continua sendo a regra da rota aberta.

### 4.6 A trilha é imutável

Não existe verbo de escrita sobre `logs_auditoria` — nem para o Admin, nem no
service, nem na rota. Uma trilha que o auditado pode corrigir não prova nada, e
a única garantia real disso é **não escrever a função**. O expurgo por prazo de
retenção é do job de LGPD, que apaga por data e nunca por alvo.

Complemento: o Admin **não filtra as próprias linhas para fora**.
`auditoria.consulta.recusarFiltroDeExclusao` recusa com 422 os parâmetros de
exclusão (`excluirAtor`, `naoAtorId`, …). Recusar com barulho, em vez de
ignorar em silêncio, deixa a tentativa registrada. Para que isso funcione, o
controller lê a query **crua** da URL: o validador descarta campo desconhecido
sem avisar, e sem o bruto a tentativa passaria despercebida.

### 4.7 Exportação nunca no caminho da resposta

Trilha e relatório vão para a **fila** (202 + protocolo). O tamanho do
resultado depende de um filtro que o cliente escolhe, e o dia em que alguém
pedir o ano inteiro é sempre o dia de uma auditoria com prazo curto. O arquivo
pronto é entregue por **link de uso único** (`lgpd.link.service`, que queima o
bilhete antes de servir) ou por link HMAC com validade (relatório).

Além do `rateLimit.escrita()` da rota (30/min, genérico demais para uma
varredura de `logs_auditoria`), há **cota própria**: 5 exportações por hora, por
administrador e por tipo, contadas no cache compartilhado. Cache fora do ar não
bloqueia — negar exportação porque o Redis caiu trocaria risco de custo por
indisponibilidade.

### 4.8 Prazo legal de 15 dias na fila do titular

A fila do encarregado é ordenada por **prazo**, não por data de criação: o que
importa é o que vence primeiro. Cada linha traz `diasRestantes`, `vencendo` e
`atrasada` calculados no servidor — se o front recalculasse, um dia calcularia
diferente. O cabeçalho traz os contadores (abertas · vencendo · atrasadas) com
cache de 60 s, invalidado nas escritas: prazo legal se mede em dias, mas
responder uma solicitação e ver o contador parado faria alguém responder de
novo.

### 4.9 Publicar Termos e o reaceite

Publicar nova versão não apaga a anterior (os consentimentos antigos apontam
para ela) e marca quem aceitou a versão velha como desatualizado. O painel
expõe `totalReaceitePendente` **antes e depois** da publicação: é o número que
decide se a publicação acontece agora ou espera, porque uma versão com
`exigirAceite` coloca a base inteira na tela de reaceite no acesso seguinte.

---

## 5. Segurança e performance — o que já está aplicado

- toda ação do painel grava `logs_auditoria` (na feature composta ou pelo
  helper), e toda leitura de dado pessoal de terceiro grava `logs_acesso_dado`;
- mapper como **lista branca** em todas as respostas — nenhuma instância do
  Sequelize sai na resposta, e `bruto`, `ip_hash`, `user_agent` e
  `email_solicitante` (na listagem) ficam de fora;
- período com teto (366 dias) e paginação com teto (200 no painel, 100 na
  trilha) em toda listagem; `attributes` explícito nas tabelas largas;
- papéis com permissões vêm com `include ... through: { attributes: [] }` e a
  contagem de usuários por papel é **um** `count` agrupado — zero N+1;
- exportação percorre a trilha em blocos com ordenação estável
  (`criado_em`, `id`), nunca `findAll` sem limite;
- cache curto no painel de conformidade, invalidado nas escritas.

---

## 6. Testes

```bash
node testes/admin.plataforma.test.js    # 51 verificações
node testes/admin.conformidade.test.js  # 42 verificações
```

Cobrem, além do caminho feliz: usuário comum → 403 em toda área; as cinco
travas do RBAC (uma a uma, inclusive pela chamada direta ao service quando o
esquema barra antes); configuração sensível mascarada na lista e no histórico;
trilha imutável (PATCH/PUT/DELETE → 404); filtro por exclusão → 422; exportação
→ 202 + cota → 429; prazo de 15 dias na fila do titular.

---

## 7. Pendências conhecidas

1. **`admin.routes.js` ainda não está montado** em `src/routes/index.js` (a
   linha existe comentada). Os testes montam o router num app próprio.
2. **`esquemas.plano` não declara `limites`**, então `POST /planos` com limites
   no corpo cria o plano sem eles — o service aceita a lista, o validador a
   descarta. Enquanto isso, a definição de limites é feita por
   `PUT /planos/:id/limites`.
3. **`esquemas.papelEdicao` não aceita `chave`**: renomear a chave de um papel
   não é possível pela API (a trava do service continua valendo para chamadas
   internas). É provavelmente o comportamento desejado — vale confirmar.
4. **`esquemas.exportacao` não tem o campo `relatorio`**, então
   `POST /relatorios/exportar` exporta sempre o `painel`. Basta acrescentar o
   campo quando desempenho e busca precisarem sair por lá.
5. **`esquemas.documentoLegal` não tem `titulo`** — o service deriva de tipo +
   versão para não gravar nulo numa coluna que a tela de aceite imprime.
6. **`lgpd.publicar_documento` é declarada sem escopo** em `rbac/recursos.js` e
   por isso escorre para o papel `usuario` via `propriasDoRecurso`. A feature
   `lgpd` compensa exigindo também `lgpd.responder_solicitacao`; a correção
   definitiva é no catálogo do RBAC.
7. **Não há tela para atribuir o coringa `*`**: o esquema recusa o formato. Se
   a cliente quiser um segundo administrador total, o caminho é atribuir o
   papel `admin` (`POST /usuarios/:id/papeis`), que é o certo — mas convém
   documentar isso na tela para não parecer limitação acidental.
