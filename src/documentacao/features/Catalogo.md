# Feature `catalogo`

Catálogo de referência da plataforma: **categorias, marcas, máquinas e
serviços**. É o que alimenta os selects do formulário de anúncio e os filtros
da busca — em outras palavras, quase toda tela do produto passa por aqui.

```
src/features/catalogo/
  catalogo.routes.js              mapa da feature: rota, limite, validação, permissão
  catalogo.controller.js          só HTTP — lê a query, chama o service, devolve
  catalogo.validators.js          esquemas de entrada (dado, não código)
  catalogo.mapper.js              model → JSON, lista branca
  catalogo.constants.js           vocabulários fechados e o TTL do cache
  catalogo.cache.js               chaves e invalidação por assunto
  catalogo.comum.js               slug único, busca sem acento, tradução de conflito

  catalogo.arvore.service.js      LEITURA de categorias: árvore, lista, detalhe
  catalogo.categoria.service.js   ESCRITA de categorias: CRUD + reordenação
  catalogo.marca.service.js       CRUD de fabricante
  catalogo.maquina.service.js     CRUD de modelo de máquina
  catalogo.servico.service.js     CRUD de serviço + reordenação
```

Um assunto por arquivo, como manda o padrão §1. Não existe
`catalogo.service.js`: os quatro assuntos parecem iguais de longe, mas cada um
tem sua própria regra de remoção segura e seu próprio conjunto de vínculos —
juntos, virariam um arquivo de 600 linhas com quatro `switch` disfarçados.

Categoria é o único assunto partido em dois arquivos, e por peso: a leitura é o
caminho quente do sistema — roda em toda tela, é servida do cache e é onde um
N+1 custa caro. A escrita roda quando o Admin abre a tela de gestão. Juntas, a
otimização de uma esbarraria na regra da outra a cada mexida.

---

## 1. Endpoints

Base: `/api/v1/catalogo`

### Leitura — pública, sem login

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/categorias` | Árvore de categorias (padrão) ou lista plana com `?arvore=false` |
| `GET` | `/categorias/:slug` | Detalhe de uma categoria |
| `GET` | `/marcas` | Marcas paginadas, com `?busca=` e `?tipo=` |
| `GET` | `/marcas/:slug` | Detalhe de uma marca |
| `GET` | `/maquinas` | Modelos, com `?marcaId=`, `?categoriaMaquina=` e `?busca=` |
| `GET` | `/maquinas/:slug` | Detalhe de um modelo |
| `GET` | `/servicos` | Serviços, com `?categoriaId=` e `?busca=` |
| `GET` | `/servicos/:slug` | Detalhe de um serviço |

Todas aceitam token opcional: o Admin logado enxerga os itens inativos na
**mesma** rota (`?incluirInativas=true`), sem uma API administrativa paralela
para manter sincronizada.

### Escrita — autenticado, protegido por RBAC

| Método | Rota | Permissão |
|---|---|---|
| `POST` | `/categorias` | `categoria.criar` |
| `PATCH` | `/categorias/:id` | `categoria.editar` |
| `DELETE` | `/categorias/:id` | `categoria.remover` |
| `PATCH` | `/categorias/ordenar` | `categoria.ordenar` |
| `POST` | `/marcas` | `marca.criar` |
| `PATCH` | `/marcas/:id` | `marca.editar` |
| `DELETE` | `/marcas/:id` | `marca.remover` |
| `POST` | `/maquinas` | `maquina.criar` |
| `PATCH` | `/maquinas/:id` | `maquina.editar` |
| `DELETE` | `/maquinas/:id` | `maquina.remover` |
| `POST` | `/servicos` | `servico.criar` |
| `PATCH` | `/servicos/:id` | `servico.editar` |
| `DELETE` | `/servicos/:id` | `servico.remover` |
| `PATCH` | `/servicos/ordenar` | `servico.editar` *(ver pendência 4)* |

---

## 2. Serviços: por que este assunto merece atenção

**A lista de serviços não veio da cliente.** O documento dela diz apenas
"informar quais serviços presta"; a lista que hoje aparece no front está
marcada como `⚠️ PROVISÓRIO`. Isso muda o desenho do módulo em três pontos:

1. **Serviço é tabela, não enum.** Cada ajuste que ela pedir precisa ser uma
   linha no banco, nunca um deploy. O model já registra isso, e o CRUD completo
   existe para que a lista seja 100% gerenciável pelo Admin desde o primeiro
   dia.
2. **A tabela nasce vazia.** Não há seed de serviços de propósito: semear a
   lista provisória daria a ela aparência de decisão tomada, e alguém a trataria
   como definitiva.
3. **Remoção de serviço é o caso mais provável de 409 do módulo.** Quando a
   lista real chegar, itens provisórios serão descartados — e alguns já terão
   sido escolhidos por prestadores. Ver §4.

---

## 3. Árvore de categorias — uma consulta, não N+1

`GET /categorias` devolve a hierarquia montada, com `filhas` aninhadas.

A implementação **não** busca as raízes e depois as filhas de cada uma: isso
seriam 13 consultas para desenhar um menu que aparece em toda tela. O banco
devolve a lista plana ordenada em **um** `SELECT` e `montarArvore()` monta a
hierarquia com um `Map`. O teste automatizado conta os `SELECT` na tabela
`categorias` e reprova se passar de um — é uma regressão fácil de introduzir
sem perceber.

**A árvore não é paginada**, e isso é deliberado: um menu com metade dos galhos
não é um menu, e o front precisa do conjunto inteiro para desenhar o select em
cascata. O conjunto é fechado (dezenas de nós) e vem do cache. Quem precisa de
lista paginada — a tela de gestão do Admin, o autocomplete — usa
`?arvore=false`, que é paginado com teto de 200.

**Filha órfã sobe para a raiz.** Se o nó do meio estiver inativo e portanto
fora do recorte, o galho inteiro sumiria da tela. Preferimos mostrá-lo no topo
a fazer conteúdo desaparecer em silêncio.

---

## 4. Remoção segura — por que 409 e não 204

As FKs de `anuncios.categoria_id` e `anuncios.marca_id` são `ON DELETE SET
NULL`. Ou seja: o banco **deixaria** apagar, e os anúncios ficariam sem
categoria — invisíveis em todo filtro da busca, sem nenhum erro que alguém
percebesse. O bug só apareceria como "meu anúncio sumiu", semanas depois.

Por isso todo `DELETE` confere os vínculos antes e devolve **409** com o
detalhe do que trava:

| Assunto | Bloqueia se houver |
|---|---|
| Categoria | anúncios, subcategorias ou serviços vinculados |
| Marca | máquinas, anúncios ou perfis que a declaram |
| Máquina | anúncios que declaram compatibilidade com ela |
| Serviço | prestadores que declaram prestá-lo |

O corpo do 409 sempre traz `sugestao: "ativo: false"`. Na prática, **desativar
é o que o Admin quer em quase todo caso**: tira o item dos formulários e dos
filtros sem apagar o que os usuários já informaram. O `DELETE` fica para o item
criado por engano.

Todas as tabelas são `paranoid`, então mesmo o `DELETE` que passa é soft
delete — recuperável por SQL.

---

## 5. Cache

TTL de **1 hora** (`TTL_CATALOGO`), com invalidação explícita em **toda**
escrita. O TTL é rede de segurança, não estratégia (padrão §7).

Uma hora não é chute: o catálogo muda quando o Admin abre a tela de gestão —
semanas entre uma alteração e outra — mas é lido em toda requisição de tela. Se
o cache de uma instância for perdido sem passar pela invalidação, uma hora é o
pior atraso possível para a mudança aparecer.

As chaves vivem em `catalogo.cache.js`, montadas sobre o prefixo comum, com
**um namespace por assunto**. A invalidação é grossa de propósito: apagar só a
chave exata exigiria conhecer todas as assinaturas de filtro já gravadas, e a
primeira combinação esquecida vira um item fantasma que só some no TTL.
Reconstruir a lista é um `SELECT` em tabela pequena.

Duas invalidações são cruzadas por dependência de dado:

- mexer em **categoria** invalida também **serviços** (a lista de serviços
  mostra o nome da categoria);
- mexer em **marca** invalida também **máquinas** (a lista de máquinas mostra
  o nome da marca).

O que vai para o cache é sempre o objeto **já mapeado**, nunca instância do
Sequelize: uma instância serializada e ressuscitada do Redis vira um objeto
meio-vivo, sem métodos e com `dataValues` aninhado, que quebra longe da causa.

---

## 6. Busca sem acento

As colunas `*_normalizado` já são gravadas minúsculas e sem acento (via
`utils/texto.normalizar`), então a consulta é um `LIKE` simples sobre elas —
`unaccent()` dentro do SQL impediria o uso do índice.

`maquinas.modelo_normalizado` tem índice trigrama (`gin_trgm_ops`), que atende
bem o `%termo%`. Em categorias, marcas e serviços o índice é btree e cobre o
caso de prefixo, que é o que o autocomplete faz. Ver pendência 2.

Termo com menos de 2 caracteres é ignorado: um `LIKE '%a%'` varre a tabela
inteira sem devolver nada útil.

---

## 7. Decisões que valem explicação

**O slug não acompanha o nome.** Corrigir uma digitação no nome não muda o
slug, porque ele já está em link compartilhado no WhatsApp e indexado pelo
Google. Trocar exige `regerarSlug: true` explícito.

**Slug de máquina carrega a marca** (`john-deere-6110j`): `6110j` sozinho
colidiria entre fabricantes e não diria nada numa URL.

**Slug duplicado ganha sufixo numérico**, não hash: `bombas-hidraulicas-2` é
legível numa URL, `bombas-hidraulicas-a91f` não. A checagem roda com
`paranoid: false` porque a unicidade é restrição do Postgres e não enxerga
`removido_em` — um registro apagado continua ocupando o slug.

**Ciclo na árvore é barrado.** Uma categoria não pode ser pai dela mesma nem
ser movida para dentro de uma descendente: `montarArvore` produziria um galho
órfão invisível na tela.

**Serviço não entra em categoria de peça.** Pendurar "Manutenção Hidráulica"
numa categoria `peca` faria o serviço aparecer no filtro de peças — visível,
errado e difícil de rastrear até a linha do banco.

**`incluirInativas` de visitante é ignorado.** A listagem é pública, então sem
essa checagem ninguém precisaria nem de conta para ver o rascunho de catálogo
que o Admin ainda não publicou.

**Reordenação é em lote e transacional.** A tela é drag-and-drop: arrastar um
item muda a posição de vários, e uma requisição por item deixaria a ordem
inconsistente se a rede caísse no meio.

**Ano de máquina tem piso em 1950.** Máquina anterior a isso não circula em MT,
e o campo aberto convida a digitar "19" e poluir o filtro de ano.

**`total_anuncios` e `total_prestadores` são expostos mas nunca escritos aqui.**
São contadores de coluna, mantidos por job (padrão §10.4). Este módulo só lê.

---

## 8. Pendências conhecidas

1. **Registrar o router.** `src/routes/index.js` é compartilhado e não foi
   editado por esta entrega. Falta a linha:
   `router.use('/v1/catalogo', require('../features/catalogo/catalogo.routes'));`
2. **Índices trigrama ausentes.** `categorias.nome_normalizado`,
   `marcas.nome_normalizado` e `servicos.nome_normalizado` não têm índice
   `gin_trgm_ops` — só máquina tem. Com o volume atual (dezenas a centenas de
   linhas) o seq scan é irrelevante; se o catálogo crescer, a busca `%termo%`
   passa a varrer a tabela. Migration a criar pelo orquestrador.
3. **Seed de catálogo.** Categorias, marcas e máquinas nascem vazias. Vale um
   seed com as marcas que circulam em MT (John Deere, Valtra, Case, New
   Holland, Massey Ferguson, Bosch) para que a primeira tela de anúncio não
   apareça com o select vazio. **Serviços continuam sem seed** — ver §2.
4. **`servico.ordenar` não existe no RBAC.** `src/rbac/recursos.js` define
   `ordenar` só para `categoria`. Enquanto não existir, reordenar serviço exige
   `servico.editar`. O mesmo vale para `marca.ordenar` e `maquina.ordenar` — a
   coluna `ordem` existe nos models e é editável via `PATCH`, mas sem endpoint
   de lote.
5. **Contadores.** `total_anuncios` e `total_prestadores` dependem de um job de
   recálculo que ainda não existe (`catalogo.recontar`, quando o módulo de
   anúncio chegar).
6. **Dúvida aberta com a cliente:** a árvore precisa de mais de dois níveis? O
   código suporta profundidade arbitrária, mas o front provavelmente assume
   dois. Vale confirmar antes que alguém crie um terceiro nível em produção.
