# Notificação

Centro nervoso dos avisos da plataforma. Todo módulo que precisa falar com um
usuário — conversa, anúncio, moderação, denúncia — passa por aqui.

---

## 1. O CONTRATO (é isto que os outros módulos consomem)

> **Não copie a query, não escreva na tabela `notificacoes`, não emita evento
> de notificação por conta própria.** Chame um dos dois caminhos abaixo. Eles
> são a mesma função; o que muda é quem espera.

### Caminho normal — pela fila

```js
const filas = require('../../filas');

await filas.enfileirar('notificacao.criar', {
  usuarioId,            // destinatário (obrigatório)
  tipo,                 // enum NOTIFICACAO_TIPO em src/models/constantes.js
  titulo,               // string curta
  mensagem,             // corpo
  dados: {},            // payload livre para o front montar o link
  entidade,             // 'anuncios' | 'conversas' | ...
  entidadeId,
  canais: ['sistema'],  // 'sistema' | 'email' | 'push'
});
```

Use este por padrão. Notificar não pode entrar no tempo de resposta de quem
mandou a mensagem, e uma falha ao notificar não pode desfazer a operação que a
originou.

### Chamada direta — mesma assinatura

```js
const notificacaoService = require('../notificacao');

const { criadas, ignorados } = await notificacaoService.criar({ /* idem */ });
```

Use quando já se está **dentro de um job** (enfileirar de dentro da fila é
volta desnecessária) ou quando quem chama precisa do registro criado de volta.

### O que o contrato garante

| Garantia | Detalhe |
|---|---|
| Preferência respeitada | Canal desligado pelo usuário não gera linha nem entrega |
| Nunca lança por caso normal | Destinatário inexistente/banido e preferência desligada devolvem `criadas: []` e o motivo em `ignorados` — não é erro, e retentar não mudaria nada |
| Uma linha por canal | `canais: ['sistema','email']` grava duas linhas; é assim que se sabe que o sininho apareceu mas o e-mail falhou |
| Tempo real automático | `NOTIFICACAO_NOVA` + `CONTADOR_ATUALIZADO` na sala do dono, depois de gravar |
| E-mail vai para a fila | O módulo encadeia `email.enviar`; **nunca** chame o provider direto |
| `dados` é higienizado | Chaves de dado pessoal de terceiro são descartadas na escrita (§6) |

Campos mapeados para o schema: `mensagem → corpo`, `entidade → referencia_tipo`,
`entidadeId → referencia_id`, `dados.link → link`.

### O que NÃO fazer

```js
// ✗ escreve direto no model — pula preferência, tempo real e contador
await db.Notificacao.create({ usuario_id, titulo });

// ✗ emite sem gravar — o aviso some se a pessoa não estiver com a tela aberta
tempoReal.paraUsuario(id, EVENTOS.NOTIFICACAO_NOVA, {...});

// ✗ manda e-mail direto — perde retentativa e amarra a resposta ao SMTP
await email.enviar({ para, assunto });
```

---

## 2. Estrutura de arquivos

```
src/features/notificacao/
  index.js                            barril: o contrato público (criar, naoLidas, ...)
  notificacao.routes.js               mapa da feature
  notificacao.controller.js           só HTTP
  notificacao.validators.js           esquemas de entrada
  notificacao.mapper.js               model → JSON (lista branca)
  notificacao.constants.js            vocabulários e limites
  notificacao.cache.js                chaves de cache da feature
  notificacao.criacao.service.js      criar + preferência + tempo real + e-mail
  notificacao.consulta.service.js     listagem paginada com escopo
  notificacao.contador.service.js     contador de não lidas (cache)
  notificacao.leitura.service.js      marcar lida: uma, várias, todas
  notificacao.preferencia.service.js  o que cada um aceita receber
  notificacao.template.service.js     texto editável pelo Admin + render
  notificacao.massa.service.js        comunicado do Admin em lote

src/filas/trabalhos/notificacao.trabalho.js   notificacao.criar · notificacao.enviarEmMassa
```

---

## 3. Endpoints

Prefixo: `/api/v1/notificacoes`. **Nenhuma rota é pública** — notificação é
dado pessoal do titular, e isso vale até para o contador.

| Método | Rota | Permissão | O que faz |
|---|---|---|---|
| GET | `/` | `notificacao.ler` | Lista paginada · `?lida=&tipo=&canal=&pagina=&porPagina=` |
| GET | `/nao-lidas` | `notificacao.ler` | Contador do sininho (cache) |
| PATCH | `/:id/ler` | `notificacao.marcar_lida` | Marca uma |
| PATCH | `/ler` | `notificacao.marcar_lida` | Marca várias (`{ ids: [] }`, teto 200) |
| PATCH | `/ler-todas` | `notificacao.marcar_lida` | Marca todas (`{ tipo? }`) |
| GET | `/preferencias` | `notificacao.preferencias` | Matriz tipo × canal |
| PUT | `/preferencias` | `notificacao.preferencias` | Salva (`{ itens: [{tipo,canal,ativo}] }`) |
| GET | `/templates` | `notificacao.template_editar` + Admin | Lista templates |
| POST | `/templates` | idem | Cria |
| GET | `/templates/:id` | idem | Detalhe |
| PUT | `/templates/:id` | idem | Edita |
| DELETE | `/templates/:id` | idem | Remove |
| POST | `/massa` | `notificacao.enviar` | Comunicado (202 + `loteId`) |

---

## 4. Tempo real

Eventos usados (todos já existiam em `src/tempo-real/eventos.js` — **nenhum
evento novo foi acrescentado**):

| Evento | Quando | Carga |
|---|---|---|
| `notificacao:nova` | linha criada no canal `sistema` | `{ notificacao, naoLidas }` |
| `notificacao:lida` | dono marcou como lida | `{ ids \| todas, naoLidas }` |
| `contador:atualizado` | sempre que o número muda | `{ naoLidas, teto, excedeuTeto }` |

A sala é sempre `salas.usuario(id)`, montada por `src/tempo-real/salas.js` e
nunca por concatenação à mão — emitir para a sala errada é entregar dado
pessoal a quem não devia ver, e uma string digitada errada não quebra teste
nenhum.

**Emitir nunca é o registro do fato.** Grava-se primeiro; o evento é entrega
complementar. Com o WebSocket fora, a pessoa vê ao abrir a tela.

---

## 5. Decisões que valem explicação

**Contador em cache, não `COUNT(*)`.** É o endpoint mais chamado da API (toda
navegação pede o sininho). Fica em `notificacao:contador:<usuarioId>`,
invalidado em toda escrita que muda o número, com TTL de 5 min só como rede de
segurança. A referência de padrão pedida era a coluna
`conversa_participantes.nao_lidas`; aqui não cabe coluna equivalente (o contador
é por usuário, não por linha de notificação), então o cache faz o papel dela —
mesmo princípio, lugar diferente.

**Contagem com teto de 100.** Ninguém lê "1.284 não lidas"; o front escreve
"99+". O `SELECT` roda dentro de um subquery com `LIMIT 100`, então a consulta
lê no máximo 100 entradas do índice `(usuario_id, lida_em)` em vez de varrer
tudo. A resposta traz `excedeuTeto` para o front saber quando escrever "+".

**Uma linha por canal.** Veio do model: é o que permite saber que o aviso
apareceu no sininho e o e-mail falhou. O contador olha só `canal = 'sistema'` —
a linha de e-mail é registro de entrega, não item de caixa de entrada.

**Preferência guarda só as exceções.** Linha ausente = ligado. Gravar a matriz
completa seriam 32 linhas por usuário quase todas dizendo "sim", e uma migração
de dados a cada tipo novo. Aviso transacional nasce ligado por legítimo
interesse (LGPD art. 7º, IX); quem exige opt-in é marketing, e isso passa pelo
consentimento `comunicacao_marketing` em `features/auth`.

**`conta_suspensa` não é silenciável no canal `sistema`.** Desligar faria a
pessoa descobrir a suspensão pelo silêncio. O pedido é recusado sem erro — o
front pode mandar a matriz inteira, e falhar tudo por um botão que nem é
clicável seria hostil sem motivo.

**Renderização de template é substituição burra de `{{chave}}`.** Um motor com
condicional e laço, num texto que o Admin edita pela web, é execução de código
de terceiro dentro do servidor. Chave ausente vira string vazia, nunca
`{{nome}}` na tela do usuário.

**Envio em massa pagina por keyset, não por OFFSET.** Com OFFSET, um cadastro
novo no meio do envio desloca a janela e alguém fica sem receber. Cada bloco de
500 é um job que reenfileira o próximo com `cursor = último id`; a base inteira
nunca está na memória, e uma falha retenta só o bloco.

**Idempotência do lote.** Toda linha do comunicado nasce com
`referencia_tipo = 'comunicados'` e `referencia_id = loteId`. Antes de inserir,
o bloco descarta quem já tem linha daquele lote — a retentativa automática da
fila não gera aviso duplicado na tela de ninguém.

**Lote não recalcula contador por pessoa.** O caro num bloco de 500 não é o
`emit` (disparo em memória no barramento), é o trabalho de banco por trás dele.
O cache dos 500 é derrubado num comando só e o evento leva apenas o aviso; quem
está com a tela aberta pede o contador uma vez.

**403 para notificação alheia e para notificação inexistente.** Diferenciar
daria um oráculo de enumeração: com uma lista de UUIDs, o código de erro diria
quais existem. O id não é adivinhável e a rota não é pública, então "não é seu"
e "não existe" são o mesmo fato do lado de fora.

**Envio em massa devolve 202, não 200.** O comunicado foi *aceito*, não
entregue. 200 daria a entender que a base inteira já recebeu antes do primeiro
bloco rodar.

**Auditoria do comunicado é gravada no pedido, não no job.** O que precisa de
rastro é a decisão humana de falar com a base inteira; se o job falhar depois,
o registro de quem mandou continua existindo.

---

## 6. `dados` é higienizado na escrita

`dados` é payload livre — e é por ser livre que precisa de rede de proteção.
"Fulano te mandou uma mensagem" com o telefone do fulano dentro é vazamento de
dado pessoal de terceiro, gravado no banco e entregue por WebSocket.

`notificacao.criacao.service.js` descarta, antes de gravar, qualquer chave cujo
nome contenha `telefone`, `whatsapp`, `celular`, `email`, `documento`, `cpf`,
`cnpj`, `senha`, `token`, `ip`, `endereco` — e qualquer valor não escalar (um
objeto aninhado esconderia um telefone um nível abaixo do filtro).

Filtrar na escrita e não na leitura é deliberado: **o que não foi gravado não
vaza por uma rota nova que alguém escreva com pressa amanhã.** Dado de contato
só sai pelo perfil, onde `exibir_whatsapp` decide — consentimento LGPD, não
preferência de UI.

---

## 7. Pendências conhecidas

1. **`src/routes/index.js` não registra a feature.** Falta a linha
   `router.use('/v1/notificacoes', require('../features/notificacao/notificacao.routes'));`
   O arquivo é compartilhado e está fora do escopo deste módulo. Até lá, só a
   suíte de teste monta as rotas (ela sobe o próprio app com os middlewares de
   produção).

2. **`notificacao.template_editar` vaza para todo usuário.** A ação foi
   declarada sem escopo em `src/rbac/recursos.js`, e
   `propriasDoRecurso('notificacao')` em `src/rbac/papeis.js` entrega toda
   permissão sem escopo ao papel `usuario`. As rotas de template exigem
   `somenteAdmin` **além** da capacidade como contenção; o conserto de verdade é
   declarar `template_editar: { escopos: ['todos'] }`.

3. **`AUDITORIA_ACAO` não tem verbo para comunicado.** O enum do banco só
   aceita `criar/editar/remover/...`, então o disparo em massa é registrado como
   `acao: 'criar'` sobre `entidade: 'notificacoes'`, com o `loteId` em
   `entidade_id` e o segmento em `depois`. Um valor `enviar_comunicado` deixaria
   a trilha legível.

4. **Canais `push` e `whatsapp` não têm provider.** Estão no enum do banco, mas
   fora de `CANAIS_ENTREGUES`: pedir esses canais devolve
   `ignorados: ['push:sem_provider']` em vez de criar linha "enviada" que nunca
   sai. A tela de preferências já os exibe, para não precisar de migração de
   dados quando existirem.

5. **Sem expurgo.** Notificação lida com meses de idade fica no banco para
   sempre. Cabe uma rotina em `manutencao.trabalho.js` apagando lidas mais
   antigas que a retenção de `config.lgpd.retencaoDias`.

6. **Contador não distingue "lida" de "vista".** O sininho zera quando a pessoa
   marca como lida, não quando abre a lista. Se a cliente quiser o
   comportamento de "abriu, zerou", é uma chamada a `PATCH /ler-todas` no front
   — decisão de produto, não de servidor.

---

## 8. Testes

`testes/notificacao.test.js` — sobe API, banco, Redis e WebSocket de verdade e
conecta um cliente `socket.io-client`. Cobre: entrega em tempo real na sala
certa e ausência dela na sala errada, recusa de socket com token inválido,
contador batendo com o banco, escopo na listagem, 403 indistinguível para
notificação alheia e inexistente, preferência desligada bloqueando a criação,
tipo não silenciável, higienização de dado de terceiro, envio em massa sem
duplicar em reprocessamento, e CRUD de template com auditoria.

```bash
node testes/notificacao.test.js
```
