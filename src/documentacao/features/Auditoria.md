# Auditoria

Trilha do que foi feito e do que foi **lido** na plataforma. É o módulo que
sustenta o poder amplo do Admin: sem rastro, flexibilidade vira risco.

---

## ⚠️ Contrato de `logs_acesso_dado` — leia antes de usar

Esta é a parte deste documento que interessa às **outras onze features**.

```js
const auditoria = require('../auditoria');

await auditoria.registrarAcessoDado(ctx, {
  titularId: conversa.interessado_id,
  recurso: auditoria.RECURSO_ACESSO.CONVERSA,
  recursoId: conversa.id,
  motivo: 'análise da denúncia #' + denuncia.id,
  denunciaId: denuncia.id,
});
```

**Quando chamar:** sempre que um Admin ou moderador **abrir dado pessoal de
alguém que não é ele** — cadastro completo, documento (CPF/CNPJ), conversa,
mensagem, endereço exato, telefone. A auditoria de alteração não cobre leitura,
e é a leitura que gera o risco: ela não deixa nenhum outro rastro no sistema.

| Parâmetro | Obrigatório | Observação |
|---|---|---|
| `titularId` | quase sempre | de quem é o dado; `null` só quando a leitura não tem titular único |
| `recurso` | **sim** | use `auditoria.RECURSO_ACESSO.*`, nunca string solta |
| `recursoId` | não | id do registro aberto |
| `motivo` | **na prática, sim** | é o que sustenta o acesso numa apuração |
| `denunciaId` | quando houver | liga o acesso à denúncia que o justifica |

### As cinco regras

1. **Nunca lança.** Não precisa de `try/catch`. Falha vira aviso no console; a
   operação de negócio segue.
2. **Acesso ao próprio dado é ignorado sozinho.** Se `titularId ===
   ctx.usuarioId`, nada é gravado. O titular lendo o que é dele não é evento de
   privacidade, e registrar isso enterraria os acessos que importam.
3. **`recurso` é vocabulário fechado.** `cadastro`, `Cadastro` e
   `dados_cadastrais` viram três coisas diferentes num agrupamento, e o
   relatório ao titular deixa de fazer sentido.
4. **`motivo` é o que salva a empresa.** "análise de denúncia #123" é
   defensável; acesso sem motivo declarado, não.
5. **Não substitui `registrar`.** Se além de ler houve mudança, chame as duas.

**Nunca use o retorno para decidir nada.** Auditoria observa, não decide.

### Lista com dado de várias pessoas

```js
await auditoria.registrarAcessoEmLote(ctx, {
  titularIds: linhas.map((l) => l.usuario_id),
  recurso: auditoria.RECURSO_ACESSO.CADASTRO,
  motivo: 'listagem de moderação',
});
```

Uma linha por titular num `bulkCreate` — o laço com `create` dentro
transformaria abrir uma tela em N inserts.

### `registrar` — a outra função

```js
await auditoria.registrar(ctx, {
  acao: 'remover', entidade: 'anuncio', entidadeId: anuncio.id,
  antes: anuncio.get({ plain: true }), motivo: 'denúncia procedente',
});
```

**A assinatura está congelada.** Onze módulos já a chamam e o `catch` interno
torna a quebra silenciosa. Campo novo entra como propriedade opcional do
segundo argumento.

Pode mandar o registro inteiro em `antes`/`depois`: eles passam por
`auditoria.mascara.js` **na gravação**.

---

## Estrutura

```
auditoria.service.js             registrar · registrarAcessoDado · registrarAcessoEmLote
auditoria.mascara.js             o que pode entrar em antes/depois
auditoria.consulta.service.js    listar · obter · daEntidade · acessosAoTitular
auditoria.exportacao.service.js  solicitar (fila) · percorrer em blocos · CSV
auditoria.constants.js           vocabulário, janelas, tetos, filtros proibidos
auditoria.mapper.js  auditoria.validators.js  auditoria.controller.js  auditoria.routes.js
index.js                         API interna usada pelas outras features
```

## Endpoints

Prefixo `/api/v1/auditoria`. Todos exigem autenticação.

| Método | Rota | Permissão |
|---|---|---|
| GET | `/` | `auditoria.ler` |
| GET | `/:id` | `auditoria.ler` |
| GET | `/entidades/:entidade/:entidadeId` | `auditoria.ler` |
| GET | `/acessos-a-dados` | `auditoria.ler` |
| POST | `/exportacoes` | `auditoria.exportar` |
| GET | `/downloads/:token` | link de uso único, do dono |

**Não existe PATCH, PUT nem DELETE.** Ver abaixo.

---

## Decisões que valem explicação

### A trilha é imutável, e a garantia é a ausência de código

Não há função de atualizar nem de remover em nenhum service, e nenhum verbo de
escrita sobre linha existente no router. Nem para o Admin. Um log que o auditado
pode editar não prova nada contra o auditado — e a única garantia real disso é
que o caminho não exista. O expurgo por prazo de retenção é do job
`lgpd.expurgar`, que apaga **por data** e nunca por alvo.

### A trilha não é filtrável por quem está sendo auditado

Filtrar *por* um ator é o uso legítimo ("quem apagou este anúncio?"). Filtrar
*tirando* um ator é como um administrador removeria as próprias linhas do
relatório que vai entregar. Por isso só existem filtros positivos, e os nomes
que alguém tentaria (`excluirAtor`, `naoAtorId`, `atorIdDiferente`,
`ocultarAtor`, `excluirAtorId`) são recusados com **422 explícito** — a
requisição crua é guardada antes da validação justamente para isso, já que o
validador descartaria o campo desconhecido em silêncio e o cliente acharia que
funcionou.

Consultar a trilha também gera `logs_acesso_dado`. Quem vasculha aparece.

### `antes`/`depois` entram mascarados

Segredo (`senha`, `token`, `codigo`) vira `[oculto]`; dado pessoal (documento,
e-mail, telefone, endereço, conteúdo de mensagem) vira `***1234`, que permite
comparar sem expor. Texto acima de 300 caracteres é cortado; lista, truncada em
50 itens.

O mascaramento é na **gravação**, não na saída. Mascarar só no mapper deixaria o
CPF em claro numa tabela que vive cinco anos, é exportada e é lida por consulta
direta em qualquer apuração — ou seja, criaria uma segunda cópia do dado com
prazo maior e mais gente autorizada, sem que ninguém tivesse decidido isso.
Auditoria precisa provar **que** o campo mudou, não repetir o valor.

### Período obrigatório com teto

Padrão de 30 dias, máximo de 366. `logs_auditoria` é a tabela que mais cresce e
o índice útil é `criado_em`. Sem recorte, a primeira consulta do painel vira
varredura completa — justamente durante uma apuração de incidente, quando o
banco lento custa mais caro. Para períodos maiores existe a exportação.

`ip_hash` e `user_agent` não saem na listagem: o hash não diz nada a um humano e
ajuda a correlacionar sessões de terceiros, que é o que a pseudonimização evita.

### Exportação sempre pela fila

Mesmo com recorte pequeno. O tamanho do resultado depende de um filtro que o
cliente escolhe, então a versão "rápida" na rota seria rápida até o dia em que
pedirem o ano fechado — e esse dia é sempre uma auditoria externa com prazo
curto. A varredura é em blocos de 1000 com ordenação estável (`criado_em`, `id`):
sem o desempate por id, duas linhas do mesmo milissegundo trocam de página e o
relatório sai com uma repetida e uma faltando.

CSV separado por ponto e vírgula: o Excel em português abre CSV com vírgula como
uma coluna só, e o relatório é lido no Excel.

### Limite de requisição por conta, não por IP

Dois `rateLimit` na mesma rota montam o mesmo identificador (método + caminho +
IP) e passam a dividir um contador só — o limite estrito herdava a contagem do
folgado e recusava antes da hora. As rotas caras usam `chave` própria, por
usuário. Isso também resolve um problema de produto: no interior de MT a região
inteira sai pelo IP da operadora.

---

## Pendências

1. **Rotas não registradas.** `src/routes/index.js` é do orquestrador; falta
   `router.use('/v1/auditoria', require('../features/auditoria/auditoria.routes'))`.
2. **`AUDITORIA_ACAO` não tem `anonimizar` nem `consultar`.** Anonimização é
   gravada como `remover` e consulta à trilha como `acessar_dado_pessoal`. Ambos
   funcionam, mas o relatório fica menos legível. Precisa de migration.
3. **Sem retenção configurável da trilha.** Os 5 anos estão no código do job de
   expurgo, não em `configuracao`. Se o jurídico definir outro prazo, hoje é
   deploy.
4. **Sem assinatura encadeada.** A imutabilidade é garantida pela API, não pelo
   banco: quem tiver acesso direto ao Postgres consegue editar uma linha. Um
   hash encadeado por linha (cada uma carregando o hash da anterior) tornaria a
   adulteração detectável. Vale a conversa se a plataforma crescer.
