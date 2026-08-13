# Moderação

A mesa de trabalho de quem cuida do conteúdo: a fila do que espera decisão, as
decisões em si e o rastro de tudo o que foi feito.

É aqui que o **poder de intervenção total do Admin** (`Maturacao/05` §2.4)
vira tela — e é aqui que ele ganha o preço combinado no `RBAC.md` §2: nenhuma
ação sai sem linha em `logs_auditoria`.

---

## 1. Arquivos

```
src/features/moderacao/
  moderacao.routes.js              mapa da feature
  moderacao.controller.js          só HTTP
  moderacao.validators.js          esquemas — é onde "motivo" vira obrigatório
  moderacao.mapper.js              model → JSON (lista branca)
  moderacao.constants.js           prazos, entidades, TTL
  moderacao.cache.js               chave do painel
  moderacao.comum.js               as quatro travas + rastro (não é service)
  moderacao.fila.service.js        fila priorizada, sem N+1
  moderacao.painel.service.js      contadores com cache curto
  moderacao.anuncio.service.js     veredito da fila: aprovar · reprovar
  moderacao.conteudo.service.js    retirada do ar: ocultar · bloquear foto
  moderacao.usuario.service.js     suspender · banir · restaurar
  moderacao.historico.service.js   o que foi feito, por quem, quando e por quê
```

`moderacao.comum.js` não é service: não implementa caso de uso. É a cola que
garante que as sete ações apliquem **as mesmas** regras — escopo total, motivo
escrito, imparcialidade e rastro — além de carregar o anúncio, gravar a linha
de `anuncio_historico` e emitir o evento. Regra repetida em sete arquivos é
regra que um dia só é corrigida em seis.

`anuncio` e `conteudo` estão separados porque são decisões diferentes: um dá o
**veredito da fila** (com efeito em `moderacao_status`), o outro **retira algo
do ar** por medida pontual, sem necessariamente julgar o anúncio.

---

## 2. Endpoints

| Método | Rota | Permissão | Observação |
|---|---|---|---|
| GET | `/v1/moderacao/painel` | `denuncia.ler` **escopo `todas`** | cache 30s |
| GET | `/v1/moderacao/fila` | `anuncio.ler` **escopo `todos`** | priorizada, paginada |
| GET | `/v1/moderacao/anuncios/:id` | `anuncio.ler` **escopo `todos`** | detalhe + fotos |
| POST | `/v1/moderacao/anuncios/:id/aprovar` | `anuncio.aprovar` | motivo opcional |
| POST | `/v1/moderacao/anuncios/:id/reprovar` | `anuncio.reprovar` | **motivo obrigatório** |
| POST | `/v1/moderacao/anuncios/:id/ocultar` | `anuncio.ocultar` | **motivo obrigatório** |
| POST | `/v1/moderacao/fotos/:id/bloquear` | `anuncio_foto.bloquear` | **motivo obrigatório** |
| POST | `/v1/moderacao/usuarios/:id/suspender` | `usuario.suspender` | **motivo obrigatório** + prazo |
| POST | `/v1/moderacao/usuarios/:id/banir` | `usuario.banir` | **motivo obrigatório** |
| POST | `/v1/moderacao/usuarios/:id/restaurar` | `usuario.restaurar` | **motivo obrigatório** |
| GET | `/v1/moderacao/anuncios/:id/historico` | `anuncio.ler` **escopo `todos`** | trilha do anúncio |
| GET | `/v1/moderacao/usuarios/:id/historico` | `usuario.ler` **escopo `todos`** | grava `logs_acesso_dado` |

Toda rota de escrita passa por `rateLimit.escrita()`: são ações com efeito
sobre a conta de outra pessoa, e um token de moderador vazado não pode banir a
base inteira em um minuto.

`moderador` tem tudo acima **menos** `usuario.banir` e `usuario.restaurar` —
essas são de Admin. Configuração, plano e RBAC não aparecem nesta feature, como
manda o `RBAC.md` §3.

---

## 3. Decisões que valem explicação

### 3.1 Capacidade na rota, escopo no service

`autorizar('anuncio.ler')` na rota confere **só a capacidade** — e o usuário
comum tem `anuncio.ler.proprio`. Sem uma segunda checagem, ele passaria pela
rota e receberia uma fila com os próprios anúncios: pior que um 403, porque
*parece funcionar*.

Por isso `moderacao.comum.js → exigirEscopoTotal()` exige escopo `todos` dentro
do service. É a mesma solução que `usuario.consulta.service.js` já usa.

### 3.2 Motivo obrigatório em toda ação punitiva

Reprovar, ocultar, bloquear foto, suspender, banir e restaurar exigem `motivo`
com pelo menos 5 caracteres. A exigência aparece **duas vezes** de propósito:
no validator (vira 422 com o campo apontado, que é o que o front sabe exibir) e
no service (vale também quando a ação vier de um job ou script).

Restaurar também exige motivo: soltar alguém é decisão tão relatável quanto
punir — e é a que mais gera pergunta depois.

### 3.3 Duas trilhas, não uma redundância

* `anuncio_historico` — trilha do **anúncio**; o dono e o suporte leem;
* `logs_auditoria` — trilha do **ator**; é o que a LGPD cobra.

Perguntas diferentes ("o que aconteceu com este anúncio?" × "o que este
moderador fez esta semana?"), tabelas diferentes. As duas são gravadas na mesma
transação da mudança: histórico sem mudança e mudança sem histórico são estados
igualmente inúteis.

### 3.4 Ninguém modera a si mesmo; ninguém age sobre Admin sem ser Admin

Duas travas em `moderacao.comum.js`:

* `garantirNaoEhVoceMesmo` — 403 `CONFLITO_DE_INTERESSE`;
* `garantirPodeAgirSobre` — se o alvo tem o papel `admin` e o ator não tem o
  coringa, 403 `ALVO_ADMINISTRADOR`. Sem isso, `usuario.banir.todos` — que um
  moderador pode legitimamente receber amanhã pela tela de RBAC — derrubaria
  quem administra a plataforma.

A checagem usa `contexto.admin` (o coringa `*` do RBAC), nunca
`if (papel === 'admin')`: quem receber o coringa amanhã passa sem ninguém
editar o arquivo.

### 3.5 Sanção encerra as sessões

Mudar `usuarios.status` não basta: o access token vale mais 15 minutos e o
refresh vale semanas. Quem foi suspenso por assédio seguiria mandando mensagem.
Suspender e banir chamam `auth.sessao.service.encerrarTodas()` e emitem
`SESSAO_ENCERRADA` para a sala do usuário — a tela dele cai sozinha.

A suspensão tem **prazo** (padrão 7 dias, teto 365). Suspensão sem data é
banimento com outro nome, e banimento tem permissão mais restrita. O prazo
vencido reativa sozinho em `auth.login.service`.

### 3.6 Reprovar não apaga, oculta

Anúncio reprovado vai para `status = oculto` com `moderacao_status = reprovado`
e o motivo gravado em `moderacao_motivo`. O dono precisa poder corrigir e voltar
à fila; apagar transformaria erro de foto em perda de anúncio.

Aprovar publica o que estava oculto, mas **não ressuscita rascunho**: o dono
ainda não pediu para publicar, e decidir por ele seria intervenção onde a
moderação não foi chamada.

### 3.7 Bloquear foto em vez de derrubar o anúncio

O caso mais comum da moderação de imagem é um anúncio legítimo com uma das oito
fotos fora das regras. `anuncio_fotos.bloqueada = true` (com `principal` zerado)
resolve sem punir o vendedor por algo que ele corrige em trinta segundos.

### 3.8 Fila sem N+1, painel com cache curto

* **Fila:** anúncio + dono (`include`, um JOIN) + denúncias abertas
  (subconsulta correlacionada), tudo em uma consulta. Colunas explícitas —
  `descricao` e `busca_texto` são TEXT e não cabem numa lista de 20 linhas.
* **Ordenação:** mais denunciado primeiro; sem denúncia, o mais antigo. Não uso
  `anuncios.total_denuncias` para ordenar porque essa coluna conta o histórico
  inteiro — um anúncio com dez denúncias já julgadas improcedentes ficaria
  eternamente no topo.
* **Painel:** três `COUNT(*)` que a tela dispara a cada F5. Cache de **30
  segundos**, invalidado explicitamente em toda ação (`moderacao.comum.js`). O
  TTL é rede de segurança para quando o Redis estiver fora no instante da
  escrita — mesmo raciocínio da feature `configuracao`.
* **A fila NÃO é cacheada**: servir uma fila velha faria dois moderadores
  pegarem o mesmo caso, ou um caso já resolvido.

### 3.9 LGPD

Abrir o histórico de sanções de uma conta grava `logs_acesso_dado`
(`recurso = ficha_moderacao`) — ali o titular da informação é a pessoa. O
histórico do anúncio não grava: ali o titular é o anúncio. Nenhum mapper emite
`ip_hash`, `senha_hash` ou `observacoes_internas`.

---

## 4. Notificação

Contrato fixo, combinado com o módulo `notificacao`:

```js
await filas.enfileirar('notificacao.criar', {
  usuarioId, tipo, titulo, mensagem, dados: {}, entidade, entidadeId,
  canais: ['sistema', 'email'],
});
```

A auditoria é gravada **antes** e aguardada; a notificação vai para a fila. Se a
linha do log não entrar, o afetado não deve ser avisado de uma punição que
ninguém consegue explicar depois.

---

## 5. Pendências conhecidas

1. **`src/routes/index.js` precisa registrar o router** (arquivo proibido a
   este módulo):
   `router.use('/v1/moderacao', require('../features/moderacao/moderacao.routes'));`
2. **`notificacao.criar` ainda não é um trabalho registrado.** Hoje o
   `enfileirar` loga `trabalho desconhecido` e segue — a punição acontece, o
   aviso não. Resolve sozinho quando o módulo `notificacao` subir.
3. **Sem ação `moderacao.*` no RBAC.** A feature reaproveita as ações
   existentes (`anuncio.*`, `usuario.*`, `denuncia.ler`). Se o produto quiser
   uma permissão "acessar o painel" separada da leitura de denúncias, é ação
   nova em `src/rbac/recursos.js`.
4. **Sem índice para o filtro `somenteDenunciados`.** A subconsulta é avaliada
   por linha; hoje a tabela é pequena. Se a fila crescer, o caminho é um índice
   parcial em `denuncias (alvo_tipo, alvo_id) WHERE status IN ('aberta','em_analise')`
   — migration, que este módulo não escreve.
5. **Reversão de decisão sobre anúncio** (desocultar, tirar a reprovação) ainda
   não tem endpoint. O dono corrige e republica pelo módulo `anuncio`; a
   intervenção direta do Admin nesse ponto ficou fora do escopo desta entrega.
