# Validação, cache e filas

Três módulos de base, no mesmo nível do RBAC. Não são features: as features
consomem, não redefinem.

```
src/validacao/     entrada: o que é dado válido
src/cache/         leitura: o que não precisa ir ao banco de novo
src/filas/         escrita lenta: o que não pode segurar a resposta
```

Os três seguem a **mesma regra**: a biblioteca fica atrás de um adaptador.
Nenhuma feature importa `zod`, `ioredis` ou `bullmq` — trocar qualquer um deles
é escrever um arquivo, não varrer o projeto.

---

## 1. Validação

### Por que existe a camada, e não `zod` direto

O sistema fala um vocabulário próprio:

```js
const { campos, esquema } = require('../../validacao');

const login = esquema({
  email: campos.email().obrigatorio('Informe seu e-mail.'),
  senha: campos.senha().obrigatorio('Informe sua senha.').min(8),
});
```

`campos.email()` não é zod — é uma **especificação neutra**, um objeto simples.
Quem a traduz é `adaptadores/zod/`. Três coisas ganham com isso:

1. **Trocar a biblioteca é um arquivo.** Se o zod mudar de rumo ou o time
   preferir outro motor, escreve-se `adaptadores/joi/` e pronto.
2. **Regra brasileira fica nossa.** CPF, CNPJ, telefone com DDD e CEP vivem em
   `regras-dominio.js`, que não conhece biblioteca nenhuma. O zod nunca aprende
   o que é CPF.
3. **O 422 é contrato nosso.** `erros.js` do adaptador traduz o erro da
   biblioteca para `{ campo: 'mensagem' }`. O front trata um formato que não
   muda quando a dependência mudar.

```
src/validacao/
  campos.js              vocabulário: texto, email, documento, telefone, lista…
  regras-dominio.js      CPF, CNPJ, telefone, CEP, aceite — sem biblioteca
  transformacoes.js      aparar, minúsculas, dígitos, E.164 — regra nossa
  contrato.js            o que um adaptador precisa implementar
  adaptadores/zod/
    index.js             monta o adaptador
    tipos.js             tipo neutro → construtor zod
    regras.js            regras → refinamento zod
    erros.js             erro zod → { campo: mensagem }
```

`npm run validacao:check` reprova se `zod` (ou joi/yup/ajv) aparecer fora de
`adaptadores/`. A abstração só vale se ninguém furar.

### O que a validação garante

**Ordem fixa:** transformar → validar → resolver presença. Validar antes de
transformar reprovaria `" JOAO@X.COM "`, que é um e-mail válido digitado por
alguém com o dedo pesado.

**Campo desconhecido é descartado**, não recusado. É o que neutraliza mass
assignment — `papeis: ['admin']` no corpo simplesmente deixa de existir — sem
quebrar um front que mande um campo a mais.

**Ausente e mal preenchido têm mensagens diferentes.** Quem esquece o nome lê
"Informe seu nome.", não "Precisa ser um texto."

**Todos os campos de uma vez.** Um erro por requisição faria o usuário corrigir
o formulário campo a campo, cada correção custando uma ida ao servidor.

### Onde declarar

Um `<feature>.validators.js` por feature, compilado no carregamento do módulo —
não a cada requisição.

---

## 2. Cache

```js
const cache = require('../../cache');

const categorias = await cache.lembrar(
  cache.chaves.categorias(),
  () => Categoria.findAll(),
  { ttl: 3600 }
);
```

### Duas decisões que sustentam o resto

**O adaptador é escolhido por chamada, não no boot.** Se o Redis cair às 14h, a
aplicação continua servindo com cache em memória. Cache é otimização — nunca
pode ser causa de queda. Pela mesma razão, toda falha de leitura ou escrita
vira log e `undefined`, jamais exceção.

**Nome de chave mora em `chaves.js`.** Chave montada com template literal
espalhada pelo projeto é o caminho curto para um cache que ninguém consegue
invalidar: quem grava usa `anuncio:${id}`, quem apaga tenta `anuncios:${id}`.

`assinatura()` ordena os filtros, então `?uf=MT&q=trator` e `?q=trator&uf=MT`
são a mesma chave — senão a taxa de acerto despenca sem ninguém notar.

### Cuidados

- **Não guarde instância do Sequelize.** O cache serializa JSON; guardar
  instância convida a chamar `.save()` num objeto que veio do cache.
- **Invalide na escrita, não no tempo.** TTL é rede de segurança, não
  estratégia: `cache.invalidar(cache.chaves.dominio('anuncios'))` depois de
  publicar.
- **`SCAN`, nunca `KEYS`.** O adaptador Redis já faz isso — `KEYS` percorre o
  keyspace travando o servidor, e uma invalidação derruba todo mundo.

---

## 3. Filas

```js
const filas = require('../../filas');

await filas.enfileirar('email.enviar', { para, modelo: 'boas_vindas', dados });
```

Quem chama não sabe se existe Redis, BullMQ ou nada disso.

### Sem Redis também funciona

O adaptador `imediato` roda o trabalho **fora do caminho da resposta**: não
aguarda a promessa e registra a falha. Parece fila (quem enfileira não espera,
falha de job não derruba requisição) sem precisar de infraestrutura.

O que ele não tem: retentativa com espera, persistência entre reinícios e
agendamento. Por isso `filas.conferirAmbiente()` avisa no boot quando produção
sobe sem Redis — precisa ser decisão, não descoberta no dia em que o provedor
de e-mail cair.

### Uma fila por natureza de trabalho

| Fila | Concorrência | Para quê |
|---|---:|---|
| `email` | 10 | E-mail transacional — depende de provedor externo |
| `notificacao` | 10 | Aviso no sistema e push |
| `midia` | 3 | Imagem de anúncio — depende de CPU |
| `indexacao` | 5 | Texto de busca e contadores |
| `manutencao` | 1 | Rotinas periódicas |

Fila única faria e-mail lento atrasar miniatura, e um relatório travado segurar
a notificação de mensagem nova.

### O worker roda separado

```bash
npm run worker
```

Job pesado dentro do processo web compete por CPU com quem está esperando uma
tela carregar. Separado, escala sozinho: em época de safra, três workers e uma
API — ou o contrário — sem tocar em código.

O worker também agenda as rotinas periódicas (fuso `America/Cuiaba`):

| Trabalho | Quando |
|---|---|
| `manutencao.limparSessoes` | 03:00 |
| `manutencao.limparTokens` | 03:15 |
| `manutencao.desbloquearContas` | a cada 10 min |

Todas apagam **lixo técnico, nunca dado do titular**. Anúncio, mensagem e
consentimento não passam por aqui — quem cuida deles é o módulo de LGPD, com
anonimização e prazo próprio.

### Registrar um trabalho novo

Criar arquivo em `trabalhos/`, sem editar nada central:

```js
const { registrar } = require('../registro');
const { FILAS } = require('../definicoes');

registrar('anuncio.reindexar', async ({ anuncioId }) => { … }, {
  fila: FILAS.INDEXACAO.nome,
});
```

O trabalho recebe `(dados, contexto)` e é função comum — sem `req`, sem `res`.
Mesmo princípio dos services: quem depende de HTTP não é reaproveitável fora
dele, e job é justamente o "fora dele".

### Duplicata

`chaveUnica` descarta job repetido — clique duplo em "reenviar código" não vira
dois e-mails:

```js
await filas.enfileirar('email.enviar', dados, { chaveUnica: `verificacao:${usuarioId}` });
```

---

## 4. Cabeçalhos de segurança

`helmet` está em `app.js` com CSP e COEP **desligados de propósito**: a API
devolve JSON, não HTML, e essas políticas só atrapalhariam o consumo pelo front
sem proteger nada aqui. Quem precisa de CSP é a aplicação Next.

O que importa neste processo e está ligado:

| Cabeçalho | Por quê |
|---|---|
| `X-Content-Type-Options: nosniff` | Impede o navegador de tratar resposta JSON como script |
| `Referrer-Policy: strict-origin-when-cross-origin` | Evita que a URL da API, com id e filtros, vaze para terceiros |
| `Strict-Transport-Security` | Só em produção — em desenvolvimento travaria `localhost` em HTTPS |
| `X-Frame-Options` | Bloqueia clickjacking se alguma rota servir HTML |

---

## 5. O que a infraestrutura mudou no rate limit

Antes o limitador contava num `Map` local. Com duas instâncias atrás de um
balanceador, o limite de 10 virava 20, e quem atacasse só precisava alternar
entre elas.

Agora conta pelo `cache`: com Redis, o limite é **compartilhado entre todas as
instâncias**; sem Redis, por processo. Se o cache ficar indisponível, o
limitador **libera** a requisição — um limitador que derruba o site quando o
Redis cai é pior que o ataque que ele evita.

Isto é a camada de **endpoint**. O bloqueio de conta por senha errada é outra
coisa, vive em `auth.tentativa.service.js` e protege o alvo, não a rota.
