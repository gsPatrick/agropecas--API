# Favorito

Anúncios salvos pelo usuário. Módulo pequeno de propósito: uma tabela, um
índice único e um contador. O que exige atenção aqui não é a regra de negócio —
é o **volume**, porque a checagem "este anúncio está favoritado?" é feita em
toda listagem do site.

---

## 1. Arquivos

```
src/features/favorito/
  favorito.routes.js               mapa da feature
  favorito.controller.js           só HTTP
  favorito.validators.js           esquemas de entrada
  favorito.mapper.js               model → JSON (lista branca)
  favorito.constants.js            tetos e colunas do card
  favorito.gerenciar.service.js    salvar e remover (idempotência + contador)
  favorito.consulta.service.js     listar, checar em lote, contador do anúncio
```

| Service | Assunto |
|---|---|
| `gerenciar` | escrita. Garante idempotência e mantém `anuncios.total_favoritos` correto. |
| `consulta` | leitura. Lista paginada, checagem em lote e o número que o dono do anúncio vê. |

Não existe `favorito.cache.js`. Cache aqui atrapalharia: a lista é pessoal
(uma entrada por usuário, taxa de acerto baixa) e muda no clique seguinte —
um coração que demora 60 segundos para acender é pior que a consulta a mais.
O contador do anúncio já é coluna, que é a forma de cache que interessa.

---

## 2. Endpoints

Prefixo sugerido: `/api/v1/favoritos`. **Nenhuma rota é pública** — favorito só
existe atrelado a uma conta.

| Método | Rota | Permissão | O que faz |
|---|---|---|---|
| `POST` | `/` | `favorito.gerenciar` | Salva o anúncio. `201` na primeira vez, `200` quando já estava salvo. |
| `DELETE` | `/:anuncioId` | `favorito.gerenciar` | Remove. `204` sempre, mesmo se não estava salvo. |
| `GET` | `/` | `favorito.ler` | Minha lista, paginada, com o card do anúncio. |
| `POST` | `/marcados` | `favorito.ler` | Checagem em lote: `{ anuncioIds: [...] }` → `{ [id]: true }`. |
| `GET` | `/anuncios/:anuncioId/contador` | `anuncio.ver_metricas` (escopo do dono) | Quantas pessoas salvaram este anúncio. |
| `GET` | `/usuarios/:usuarioId` | `favorito.ler.todos` | Lista de terceiro — apuração. 403 para quem não é Admin. |

---

## 3. Decisões que valem explicação

### Favoritar é idempotente, e isso não é conveniência

O índice único `(usuario_id, anuncio_id)` é a garantia; `findOrCreate` é o
caminho feliz. Clicar duas vezes no coração com a rede lenta é comportamento
normal, não erro — devolver `409` faria o front tratar exceção para um caso
que não é excepcional.

O que **não** pode se repetir é o contador: `total_favoritos` só sobe quando a
linha nasceu. Sem essa condição, o duplo clique inflaria justamente o número
que o dono do anúncio usa para decidir se o preço está bom.

O `increment` do Sequelize é usado em vez de ler-somar-gravar porque dois
cliques simultâneos, em instâncias diferentes, perderiam uma contagem. O
`decrement` carrega `total_favoritos > 0` no `where` para o contador não ir a
negativo se alguém corrigir a tabela na mão.

### A checagem em lote é o ponto crítico

A tela de listagem precisa pintar 20 corações. Perguntando por card, uma tela
custa 20 idas ao banco; com scroll infinito, centenas. `POST /marcados` resolve
tudo em **uma** consulta `WHERE anuncio_id IN (...)`, sem `include`, devolvendo
um mapa `{ id: true }`.

É `POST` e não `GET` porque a entrada é uma lista de até 120 UUIDs — o que
estoura o limite prático de uma query string. O teto de 120 impede transformar
a rota num `IN (...)` de dez mil itens, que o Postgres aceita e demora.

O retorno é mapa e não lista porque o front indexa por id ao renderizar;
devolver array o obrigaria a montar o mapa de novo ou a fazer `includes()`
dentro do laço de render.

`testes/favorito.test.js` conta o SQL emitido e reprova se 42 ids gerarem mais
de uma consulta.

### Anúncio removido some da lista

`include` com `required: true`. O model `Anuncio` é `paranoid`, então o join
vira INNER e a linha órfã não volta — sem `WHERE removido_em IS NULL` escrito
à mão em cada consulta. A FK é `CASCADE`, então o favorito some junto na
exclusão definitiva; o INNER cobre a janela do soft delete.

A linha continua no banco de propósito: se o Admin restaurar o anúncio, o
favorito volta a aparecer.

### Ninguém lê o favorito de outro

Favorito é dado pessoal — a lista de salvos de alguém diz o que ele quer
comprar, quanto pode gastar e para qual máquina. O dono é decidido pelo RBAC
(`exigir(ctx, 'favorito.ler', { donoId })`), nunca pelo parâmetro da rota:
quem só tem `favorito.ler.proprio` recebe `403` antes de qualquer consulta.

`usuario_id` sai sempre de `contexto.usuarioId`. Não existe o campo no corpo de
nenhum esquema — nem "só para o Admin", porque é o tipo de brecha que passa na
revisão justamente por o front nunca mandar o campo.

### O dono vê o número, não os nomes

`GET /anuncios/:id/contador` devolve `total` e nada mais, sob
`anuncio.ver_metricas`. Saber que "12 pessoas salvaram" é produto; saber
**quem** seria expor interesse de compra de terceiro sem que ele tenha se
apresentado. Quem quer falar usa `features/contato`.

### `attributes` explícito no card

`anuncios` guarda `descricao` e `busca_texto` em `TEXT`, e nenhum card usa
nenhum dos dois. A lista de colunas está em `favorito.constants.js`
(`COLUNAS_ANUNCIO`), num lugar só, porque a consulta de salvar e a de listar
precisam devolver o mesmo card.

Só a foto **principal** entra no `include` — trazer as oito fotos de cada
anúncio para desenhar uma miniatura é o N+1 disfarçado de `include`.

---

## 4. Pendências conhecidas

1. **Registro do router.** `src/routes/index.js` é proibido de editar enquanto
   os módulos são escritos em paralelo. Falta a linha
   `router.use('/v1/favoritos', require('../features/favorito/favorito.routes'))`.
2. **`anuncio_metricas_diarias.favoritos` não é alimentado.** A coluna existe e
   o painel do anúncio vai querer a série ("salvaram 4 vezes na terça"). O
   contador acumulado está correto; o histórico diário depende de um job que
   ainda não existe — o de `contato.trabalho.js` é o molde.
3. **Notificação ao anunciante.** Hoje favoritar não avisa ninguém. É
   deliberado: aviso a cada coração vira ruído. Se a cliente quiser, o caminho
   é um resumo diário, não um evento por clique.
4. **Filtro por tipo/status na listagem** aceita qualquer texto de até 20
   caracteres em vez de um `umDe` fechado, porque os vocabulários vivem em
   `models/constantes.js` e amarrar aqui duplicaria a lista. Vale trocar por
   `campos.umDe(ANUNCIO_TIPO)` quando o módulo de anúncio estabilizar.
