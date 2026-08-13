# Plano e assinatura

> **O MVP é gratuito.** Este módulo não cobra, não fala com gateway e não tem
> checkout. Ele existe para que ligar a monetização um dia seja **alterar o
> valor de um limite**, não reescrever o núcleo (Maturacao/01, §3 e §4).

---

## 1. O contrato que os outros módulos consomem

**Leia esta seção antes de escrever o módulo `anuncio` ou `midia`.** É a única
parte deste documento que outro time precisa conhecer.

```js
const plano = require('../plano');   // src/features/plano/index.js
```

### `podeUsar(usuarioId, chave, quantidade = 1)`

```js
const veredito = await plano.podeUsar(ctx.usuarioId, plano.LIMITES.ANUNCIOS_ATIVOS);
```

```jsonc
{
  "chave": "anuncios.ativos",
  "permitido": true,        // única coisa que o chamador precisa decidir
  "ilimitado": true,        // limite null OU chave não cadastrada
  "limite": null,           // null = ILIMITADO, nunca zero
  "usado": 0,               // 0 quando ilimitado — ver nota abaixo
  "restante": null,         // null quando ilimitado
  "periodo": "total",       // total | dia | semana | mes
  "planoChave": "gratuito_mvp",
  "degradado": false        // presente só quando o cálculo falhou
}
```

### `registrarUso(usuarioId, chave, quantidade = 1, { transacao } = {})`

```js
await plano.registrarUso(ctx.usuarioId, plano.LIMITES.ANUNCIOS_ATIVOS, 1, { transacao });
await plano.registrarUso(ctx.usuarioId, plano.LIMITES.ANUNCIOS_ATIVOS, -1); // devolve a vaga
```

```jsonc
{ "chave": "anuncios.ativos", "quantidade": 3, "periodoInicio": "1970-01-01", "periodoFim": null }
```

### `exigirLimite(usuarioId, chave, quantidade = 1)`

Mesma verificação, lançando `403 SEM_PERMISSAO` com mensagem padronizada. Use
quando o chamador só quer barrar e não tem o que fazer com o veredito.

### Regras que o consumidor NÃO deve reimplementar

| Regra | Comportamento |
|---|---|
| `limite = null` | **ILIMITADO.** Nunca trate como zero — travaria a plataforma inteira no MVP. |
| chave não cadastrada | Ilimitada. Um módulo pode perguntar por quota que o Admin ainda não criou. |
| usuário sem assinatura | Cai no **plano padrão** (`gratuito_mvp`). Ninguém fica sem limites. |
| chave com `_` ou `.` | `anuncios_ativos` e `anuncios.ativos` são a mesma coisa. |
| falha de banco/cache | `podeUsar` devolve `permitido: true` com `degradado: true`. Nunca lança. |
| ordem | **Verifique antes, registre depois.** `podeUsar` é consulta, não reserva. |

**Por que `usado` volta 0 quando é ilimitado:** contar consumo que não muda
decisão nenhuma seria um `SELECT` a mais em toda publicação — e hoje quase tudo
é ilimitado. Quem quer o número real (tela "meu uso") chama `plano.panorama()`.

**Chaves conhecidas** (`plano.LIMITES`, semeadas no seeder base):

| Constante | Chave | Período | Valor no MVP |
|---|---|---|---|
| `ANUNCIOS_ATIVOS` | `anuncios.ativos` | total | `null` (ilimitado) |
| `ANUNCIOS_POR_MES` | `anuncios.por_mes` | mes | `null` (ilimitado) |
| `FOTOS_POR_ANUNCIO` | `fotos.por_anuncio` | total | `8` |
| `DESTAQUES_POR_MES` | `destaques.por_mes` | mes | `0` |

> `fotos.por_anuncio` é limite **por anúncio**, não por conta. `registrarUso`
> não serve para ele: quem conta foto de um anúncio é o próprio anúncio.
> Use apenas `podeUsar(...).limite` para saber o teto e valide a contagem
> localmente. Está registrado como pendência (§7).

---

## 2. Estrutura de arquivos

```
src/features/plano/
  index.js                       superfície pública consumida por outros módulos
  plano.routes.js                mapa da feature
  plano.controller.js            só HTTP
  plano.validators.js            esquemas de entrada
  plano.mapper.js                model → JSON (lista branca)
  plano.constants.js             chaves de limite, TTLs, normalização
  plano.comum.js                 cálculo do balde de medição (dia/semana/mês)
  plano.cache.js                 chaves de cache e invalidação
  plano.consulta.service.js      catálogo público + resolução do plano efetivo
  plano.limite.service.js        podeUsar · registrarUso · exigirLimite ← o núcleo
  plano.uso.service.js           panorama de consumo (tela "meu uso")
  plano.admin.service.js         CRUD de plano e de limites (Admin)
  plano.assinatura.service.js    atribuir · cancelar · minha · histórico
```

O `index.js` é a **única exceção do projeto** à regra "sem barril de feature",
e ela é deliberada: este módulo tem consumidores internos. Sem o barril,
`anuncio` e `midia` importariam `plano.limite.service.js` pelo caminho do
arquivo, e renomear um service quebraria três módulos.

---

## 3. Endpoints

Prefixo sugerido: `/api/v1/planos`.

| Método | Rota | Permissão | O que faz |
|---|---|---|---|
| GET | `/` | **pública** | Tabela de preços. Com token de Admin, aceita `incluirInativos` e `incluirOcultos`. |
| GET | `/minha-assinatura` | autenticado | Plano vigente, limites e consumo de cada um. |
| GET | `/minha-assinatura/historico` | autenticado | Planos anteriores, paginado. |
| GET | `/meus-limites/:chave` | autenticado | O mesmo veredito de `podeUsar`, para a tela desabilitar o botão antes do envio. |
| GET | `/:id` | autenticado | Detalhe de um plano. |
| POST | `/` | `plano.criar` | Cria plano (com limites, opcionalmente). |
| PATCH | `/:id` | `plano.editar` | Altera plano. |
| PUT | `/:id/limites` | `plano.editar` | **Substitui** a lista de limites. |
| DELETE | `/:id` | `plano.remover` | Remoção lógica. |
| POST | `/atribuir` | `plano.atribuir` | Coloca um usuário num plano (cria `Assinatura`). |

---

## 4. Decisões que valem explicação

**Ninguém fica sem plano.** Sem assinatura, com assinatura cancelada ou
vencida, a resposta é sempre o plano `padrao`. A alternativa — devolver "sem
plano" — transformaria um registro ausente em bloqueio de publicação para a
plataforma inteira.

**`null` é ilimitado, e viaja como `null`.** Já foi tentador usar `-1` ou `0`
como sentinela; os dois se confundem com "nenhum" na tela e no `if` de quem
consome. O mapper devolve `valor: null` acompanhado de `ilimitado: true`, para
que ninguém precise saber da convenção.

**Contador atômico.** `registrarUso` faz `UPDATE quantidade =
GREATEST(quantidade + n, 0)`. Ler-somar-gravar faria duas publicações
simultâneas do mesmo usuário lerem o mesmo valor, e a quota valeria o dobro. O
`GREATEST` no banco (e não em JS) impede que devolver a vaga duas vezes por
engano deixe o contador negativo.

**Balde de medição.** Limite `por_mes` conta dentro do mês corrente: virar o mês
é gravar em outra linha de `usos_medidos`, sem job de reset e sem perder
histórico. Datas em **UTC**, porque misturar fuso local do container com
`DATEONLY` faria o contador zerar em horários diferentes conforme a máquina.
`total` é quota de estado ("quantos ativos agora"), guardada numa linha única
com data-sentinela `1970-01-01`.

**Dois TTLs de cache, não um.** Limites (300s) mudam quando o Admin edita o
plano — raro, e as duas operações invalidam explicitamente. Uso (20s) muda a
cada publicação, e `registrarUso` invalida a chave. Prefixos separados
(`catalogo`, `limites`, `uso`) porque, num prefixo só, registrar um uso
derrubaria a tabela de preços pública a cada anúncio publicado.

**`podeUsar` nunca lança.** Um verificador de quota que impede publicar quando o
Redis cai causa mais prejuízo do que a quota que protege — e o MVP não cobra
por nada. Falha vira `permitido: true` com `degradado: true` e um `console.error`.

**Limites são substituídos, não mesclados.** `PUT /:id/limites` faz da lista
enviada a verdade. É o que torna a tela do Admin previsível e evita limite
fantasma que a API só sabe somar. Roda em transação: uma falha no meio deixaria
o plano *sem limite nenhum*, que por regra deste módulo significa "ilimitado" —
a falha abriria a porteira em silêncio.

**Plano padrão é protegido.** Não pode ser removido nem desativado, e plano com
assinante ativo devolve 409 em vez de deixar assinatura órfã.

**`usuarioId` no corpo de `/atribuir`.** É a exceção consciente ao padrão §11.2
("id sai do contexto"): a ação é do Admin *sobre outra pessoa*. A rota exige
`plano.atribuir`, que só o Admin tem, e a operação grava auditoria com
`em_nome_de`.

---

## 5. Segurança

- Criar/editar/remover plano e atribuir assinatura passam por `autorizar()` no
  RBAC. Não há `if (papel === 'admin')` em lugar nenhum.
- Consumo é sempre do **próprio** usuário: `/meus-limites/:chave` e
  `/minha-assinatura` leem `contexto.usuarioId`. Deixar consultar quota alheia
  entregaria de graça quanto o concorrente já publicou.
- `referencia_externa` da assinatura (id no futuro gateway) **nunca** sai no
  mapper.
- Auditoria em toda atribuição de plano e toda mudança de limite, com `antes` e
  `depois`, para responder "quem baixou meu limite e quando".

---

## 6. Testes

`testes/plano.test.js` — 44 verificações, contra a API e o banco reais. Cobre
os vetores obrigatórios: limite nulo é ilimitado (inclusive depois de 50 usos),
usuário sem assinatura cai no gratuito, `podeUsar` bloqueia ao estourar o teto,
devolver a vaga libera de novo, contador nunca fica negativo, usuário comum
criando/atribuindo plano recebe 403, e o consumo exibido é o do próprio token.

---

## 7. Pendências conhecidas

1. **Rotas não montadas.** `src/routes/index.js` é compartilhado e não pode ser
   editado por este módulo. Falta a linha
   `router.use('/v1/planos', require('../features/plano/plano.routes'));`.
2. **`logs_auditoria.acao` é ENUM curto** (`criar`, `editar`, `remover`…).
   Atribuir plano e definir limite gravam como `editar` nas entidades
   `assinatura` e `plano`. Valores próprios (`plano_atribuir`,
   `plano_limite_editar`) tornariam a consulta da trilha bem mais direta, mas
   exigem migration.
3. **`fotos.por_anuncio` não tem contador.** É limite por anúncio, não por
   conta; `usos_medidos` é por conta. O módulo de mídia deve ler o teto por
   `podeUsar(...).limite` e contar as fotos do anúncio localmente.
4. **`podeUsar` não reserva.** Entre a verificação e a gravação cabe outra
   requisição do mesmo usuário. Irrelevante enquanto tudo é ilimitado; quando
   houver plano pago, a reserva atômica entra neste módulo, não no chamador.
5. **Nenhum cadastro cria assinatura.** Hoje todo mundo cai no plano padrão por
   ausência, o que funciona por desenho. Se algum dia for preciso saber *desde
   quando* alguém está no gratuito, o registro terá de ser criado no fluxo de
   cadastro (`auth.registro.service.js`).
