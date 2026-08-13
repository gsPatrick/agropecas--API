# Busca

Módulo de busca de anúncios: termo livre tolerante a erro de digitação,
filtros compostos, proximidade geográfica, facetas, autocomplete, log de busca
e termos populares.

É a rota mais chamada e a mais raspável do sistema. Quase toda decisão aqui foi
tomada a partir disso.

---

## 1. Estrutura de arquivos

```
src/features/busca/
  busca.routes.js               mapa da feature (todas as rotas são públicas)
  busca.controller.js           só HTTP
  busca.validators.js           esquemas de entrada (nomes curtos = os da URL do front)
  busca.mapper.js               linha do banco → JSON, com as regras de LGPD
  busca.constants.js            TTLs, tetos, vocabulários, nomes dos jobs
  busca.cache.js                chaves de cache da feature
  busca.comum.js                montagem de SQL (WHERE, relevância, Haversine, binds)

  busca.filtro.service.js       query da URL → recorte normalizado + assinatura de cache
  busca.consulta.service.js     a consulta de resultados (o coração)
  busca.faceta.service.js       contagem por categoria/tipo/condição/UF
  busca.sugestao.service.js     autocomplete
  busca.localizacao.service.js  resolve o ponto de origem (coordenada, cidade, CEP)
  busca.log.service.js          registro do que foi buscado (via fila)
  busca.termo.service.js        termos populares: leitura e agregação

src/filas/trabalhos/busca.trabalho.js
  busca.registrarLog             alta frequência, tira o INSERT do caminho da resposta
  busca.agregarTermosPopulares   periódico (de hora em hora), consolida o log
```

`busca.comum.js` não é service: não tem regra de negócio, não conhece contexto
e não fala com o banco. Existe porque a consulta de resultados e a de facetas
precisam do **mesmo** `WHERE` — se cada uma montasse o seu, a contagem da
faceta divergiria da lista na primeira correção feita só de um lado.

---

## 2. Endpoints

| Método | Rota | Permissão | Rate limit | O que faz |
|---|---|---|---|---|
| GET | `/v1/busca` | pública | 120/min | Lista paginada de anúncios |
| GET | `/v1/busca/facetas` | pública | 60/min | Contagem por categoria, tipo, condição e UF do mesmo recorte |
| GET | `/v1/busca/sugestoes` | pública | 240/min | Autocomplete (categoria, máquina, marca, anúncio) |
| GET | `/v1/busca/termos-populares` | pública | 300/min | "Peças mais procuradas" da home |
| POST | `/v1/busca/clique` | pública | 30/min | Marca em qual resultado a pessoa clicou |

Nenhuma exige login (`autenticacaoOpcional`): encontrar peça é o que o
visitante faz **antes** de decidir criar conta. Quem está logado tem a busca
registrada com `usuario_id`.

### Parâmetros de `GET /v1/busca`

Os nomes curtos são os que o front **já** coloca na URL — e a URL da busca é
compartilhada por WhatsApp. Renomear quebraria todo link já enviado.

| Parâmetro | Apelido longo | Observação |
|---|---|---|
| `q` | `termo` | mínimo 2 caracteres, máximo 120 |
| `cat` | `categoria` | slug ou id; **arrasta as subcategorias** |
| `marca`, `maquina` | — | slug ou id |
| `tipo` | — | `peca` \| `servico` \| `procura` |
| `cond` | `condicao` | `nova` \| `usada` \| `recondicionada` \| `nao_se_aplica` |
| `min`, `max` | — | **em reais**, como o slider do front manda |
| `aCombinar` | — | filtro exclusivo: só "consultar valor" |
| `dias` | — | publicado nos últimos N dias |
| `cidade`, `uf`, `municipioId` | — | filtro por local |
| `lat`, `lon`, `cep`, `raioKm` | — | busca por proximidade |
| `ord` | `ordem` | `relevancia` \| `recentes` \| `menorPreco` \| `maiorPreco` \| `proximos` |
| `p`, `pp` | `pagina`, `porPagina` | `pp` no máximo **35** |
| `origem` | — | de onde veio (`hero`, `listagem`, `header`, `atalho`) — só para o relatório |

`min`/`max` vêm em **reais** e não em centavos porque é o que o slider do front
produz. Deixar o cliente mandar centavos convidaria ao erro de 100×.

---

## 3. Estratégia de relevância

### 3.1 Como um termo errado encontra o certo

O usuário digita "rolamentu". O anúncio diz "rolamento". Três condições em `OR`
resolvem isso, **todas servidas pelos índices trigrama que já existem no
schema**:

```sql
a.busca_texto LIKE '%' || $1 || '%'   -- substring exata  → idx_anuncios_busca_trgm
OR $1 <% a.titulo_normalizado         -- word_similarity  → idx_anuncios_titulo_trgm
OR $1 <% a.busca_texto                -- word_similarity  → idx_anuncios_busca_trgm
```

`<%` é `word_similarity`: compara o termo contra a **melhor palavra** do texto.
O operador `%` (similaridade simples) compararia contra o texto inteiro, e a
similaridade de uma palavra dentro de uma descrição de 300 caracteres dá quase
zero — na prática, `%` não encontraria nada. Medido:
`word_similarity('rolamentu', 'rolamento de roda ...') = 0.8`, acima do limiar
padrão de 0.6, então **não é preciso mexer em `pg_trgm.word_similarity_threshold`**
(o que exigiria `SET LOCAL` numa transação e três round-trips a mais por busca).

Não é preciso chamar `unaccent()` na consulta: as colunas `*_normalizado` e
`busca_texto` já são gravadas sem acento e em minúsculas pelo módulo de anúncio,
e envolver a coluna numa função esconderia o índice dela.

**Nenhuma condição não indexável pode entrar nesse `OR`.** A primeira versão
tinha `OR a.codigo_peca_normalizado = $1` ali; como essa coluna não tem índice,
o planejador desistia do `BitmapOr` e varria a tabela inteira — **343 ms** com
20 mil linhas, contra **3 ms** depois de tirá-la. O código de peça continua
encontrável porque `busca_texto` já o contém.

### 3.2 A nota

```
  3.0  se o código de peça bate exatamente
+ 2.0  se o título é idêntico ao termo
  1.2  se o título começa com o termo
  0.8  se o título contém o termo
+ 1.0 × word_similarity(termo, titulo_normalizado)
+ 0.3 × word_similarity(termo, busca_texto)
```

É soma de sinais, e não um número mágico do Postgres, para que seja possível
explicar por que um anúncio está acima do outro. Os pesos seguem a certeza da
intenção: quem digita part number quer aquele item específico; quem digita duas
palavras que aparecem no título provavelmente quer aquilo; a descrição pesa
pouco porque texto longo casa com qualquer coisa.

Empate é resolvido por `publicado_em DESC` e, por fim, por `id` — sem esse
desempate a página 2 pode repetir um item da página 1.

**Ordem padrão:** com termo, relevância; sem termo, "mais recentes". Ordenar
por relevância uma lista sem termo é ordenar por zero, ou seja, pela ordem
física do disco — que muda entre duas visitas e embaralha a paginação.

---

## 4. Performance

### 4.1 A forma da consulta principal

```sql
WITH base AS (            -- 1. reduz a 20 ids, com relevância/distância
  SELECT a.id, ... FROM anuncios a <joins> WHERE <filtro> ORDER BY <ordem> LIMIT 20 OFFSET n
),
total AS (                -- 2. o total do recorte, sem tocar em foto
  SELECT count(*) FROM anuncios a <joins> WHERE <filtro>
)
SELECT <colunas>, base.relevancia, total.quantidade   -- 3. só agora as colunas e a capa
  FROM base JOIN anuncios a ON a.id = base.id
  <joins 1:1> LEFT JOIN LATERAL (foto de capa) ON true CROSS JOIN total
```

Três decisões, todas **medidas** com `EXPLAIN ANALYZE` sobre 20 mil anúncios:

1. **`LIMIT` antes da foto.** Na versão óbvia (tudo num `FROM` só) o
   `LEFT JOIN LATERAL` da capa roda **antes** do `LIMIT`: numa busca com 1.300
   resultados o banco procurava 1.300 fotos para exibir 20. No plano atual a
   LATERAL aparece com `loops=20`.
2. **`count(*)` em CTE, não `count(*) OVER ()`.** A função de janela obriga a
   materializar todas as linhas antes do `LIMIT`. Na vitrine sem filtro (19.136
   publicados) isso mediu **26 ms**; com o total em CTE separado, **2,3 ms**. Em
   busca com termo os dois empatam. Continua sendo **um round-trip e uma
   transação implícita**, então total e lista nunca discordam.
3. **Sem `NULLS LAST` na data.** `publicado_em DESC NULLS LAST` não casa com
   `idx_anuncios_vitrine` (que é `DESC` puro) e trocava o Index Scan por um Sort
   de 19 mil linhas: **47 ms** contra **15 ms**.

Uma única consulta cobre categoria, marca, município, anunciante e foto de capa
— todos os JOINs são 1:1, nenhum multiplica linha, então não há `DISTINCT` nem
contagem inflada. A compatibilidade com máquina, que é N:N, entra como `EXISTS`
justamente por isso.

`descricao` (TEXT) **não** é selecionada: a listagem não a usa, e trazê-la
significaria dezenas de KB por página jogados fora.

### 4.2 Proximidade sem calcular Haversine para a tabela inteira

1. **Caixa envolvente** primeiro: `latitude BETWEEN ... AND longitude BETWEEN ...`,
   que é comparação de faixa e o índice consegue usar.
2. **Haversine** só no que sobrou, para cortar os cantos do retângulo (a caixa é
   maior que o círculo — sem isso "até 50 km" entregaria pontos a 70 km na
   diagonal).

A caixa é escrita em dois ramos (`a.latitude` quando existe, `mu.latitude`
quando o anúncio só informou a cidade) em vez de um `coalesce`, porque o
primeiro ramo é sargável.

`least/greatest` prendem o argumento do `acos` em `[-1, 1]`: erro de ponto
flutuante em coordenadas idênticas produz `1.0000000002` e o Postgres estoura
com *input is out of range* — falha que só aparece quando alguém busca
exatamente do próprio ponto.

### 4.3 Cache

| O que | TTL | Por quê |
|---|---|---|
| Resultado da busca | 45 s | Cobre o link compartilhado no zap que 20 pessoas abrem juntas, o "voltar" do anúncio para a lista e o raspador que pagina. Acima de um minuto, o anunciante liga reclamando que o anúncio "não apareceu". |
| Facetas | 60 s | Chave sem paginação: quem folheia 10 páginas paga a agregação uma vez. |
| Sugestões | 5 min | A rota é chamada **a cada tecla**; "rol", "rola", "rolam" são três chaves que quase todo usuário percorre. |
| Termos populares | 10 min | Já vem de tabela agregada. |
| Coordenada de município | 1 h | Tabela do IBGE — muda de década em década. |

A chave vem de `cache.assinatura(filtros)` sobre os filtros **já normalizados**:
`?uf=mt` e `?uf=MT` são a mesma busca, e `?uf=MT&q=trator` e `?q=trator&uf=MT`
também. Sem isso o cache "funciona" e nunca acerta.

Resultado vazio **também** é cacheado: é exatamente o que um raspador repete.

Este módulo é a exceção assumida à regra "TTL é rede de segurança, não
estratégia" (PADRAO_MODULO §7): a busca não é invalidada na escrita. Obrigar o
módulo de anúncio a conhecer as chaves daqui acoplaria os dois, e 45 segundos
de atraso é aceitável para uma listagem. `busca.cache.invalidarTudo()` existe
para o Admin forçar limpeza depois de uma moderação em massa.

### 4.4 `EXPLAIN ANALYZE` das consultas principais

Ambiente: Postgres 16.14, `anuncios` com **20.194 linhas** (19.136 publicadas),
`anuncio_fotos` com uma capa por anúncio, `ANALYZE` rodado antes das medições.

#### (1) Termo livre com erro de digitação — `?q=bomba hidraulic` — ordem: relevância

```
Incremental Sort (actual time=17.471..17.476 rows=20 loops=1)
  ->  Nested Loop  (actual time=17.052..17.411 rows=20 loops=1)
        ->  Nested Loop Left Join (rows=20)
              ->  Limit (actual time=11.571..11.576 rows=20 loops=1)
                    ->  Sort (rows=20)   Sort Key: <relevância> DESC, publicado_em DESC, id
                          ->  Nested Loop (actual time=4.225..11.480 rows=375 loops=1)
                                ->  Bitmap Heap Scan on anuncios a_1 (rows=375)
                                      Recheck Cond: ((busca_texto ~~ '%bomba hidraulic%')
                                        OR ('bomba hidraulic' <% titulo_normalizado)
                                        OR ('bomba hidraulic' <% busca_texto))
                                      ->  BitmapOr (actual time=4.130..4.131)
                                            ->  Bitmap Index Scan on idx_anuncios_busca_trgm  (rows=335)
                                            ->  Bitmap Index Scan on idx_anuncios_titulo_trgm (rows=422)
                                            ->  Bitmap Index Scan on idx_anuncios_busca_trgm  (rows=335)
                                ->  Memoize (Cache Key: a_1.perfil_id)  loops=375
              ->  Limit (rows=1 loops=20)          <-- foto de capa: 20 loops, não 375
                    ->  Index Scan using anuncio_fotos_anuncio_id_ordem on anuncio_fotos f
        ->  Materialize -> Aggregate (total do recorte, rows=375)
Execution Time: 17.886 ms
```

Os três índices trigrama entram num `BitmapOr` — **nenhum Seq Scan em
`anuncios`**. A LATERAL da foto roda 20 vezes (a página), não 375 (o recorte).

#### (2) Filtros combinados sem termo — `?tipo=peca&cond=usada&min=100&max=3000&uf=MT` — ordem: recentes

```
->  BitmapAnd
      ->  Bitmap Index Scan on anuncios_preco_centavos (rows=6061)
            Index Cond: (preco_centavos >= 10000 AND preco_centavos <= 300000)
      ->  Bitmap Index Scan on anuncios_tipo_status   (rows=11157)
            Index Cond: (tipo = 'peca' AND status = 'publicado')
->  Index Scan Backward using anuncios_status_publicado_em on anuncios a_2 (rows=21)
Execution Time: 3.741 ms
```

A página usa o índice de data (só 21 linhas lidas para devolver 20); o total usa
o `BitmapAnd` de preço + tipo/status.

#### (3) Proximidade — `?q=bomba&lat=-14.6229&lon=-57.4933&raioKm=150&ord=proximos`

```
->  Bitmap Heap Scan on anuncios (rows=1003 após a caixa envolvente)
      ->  BitmapOr
            ->  Bitmap Index Scan on idx_anuncios_busca_trgm  (rows=1003)
            ->  Bitmap Index Scan on idx_anuncios_titulo_trgm (rows=1186)
            ->  Bitmap Index Scan on idx_anuncios_busca_trgm  (rows=1003)
      Filter: <caixa envolvente> AND <Haversine <= 150>
Execution Time: 8.112 ms
```

Aqui o termo carrega o filtro e a caixa entra como recheck. **Sem termo**, a
proximidade cai em Seq Scan — ver a pendência de índice em §8.

#### (4) Vitrine sem filtro nenhum — ordem: recentes

```
Sort (actual time=15.236..15.241 rows=20 loops=1)
  ->  Nested Loop Left Join (rows=20)
        ->  Index Scan Backward using anuncios_status_publicado_em (rows=50)
        ->  Aggregate  (actual time=14.742..14.743)
              ->  Hash Join (rows=19136)
                    ->  Seq Scan on anuncios a_1 (rows=19136)   <-- o total, não a página
Execution Time: 15.311 ms
```

A **página** sai por índice em fração de milissegundo. Os 15 ms são o
`count(*)` do recorte vazio, que é intrinsecamente O(n) — qualquer forma de
contar 19 mil linhas custa isso. É o pior caso do módulo e ele é servido do
cache em 45 s.

#### (5) Facetas — `?q=rolamento&facetas=true`

```
->  GroupAggregate / GroupingSets
      ->  Bitmap Heap Scan on anuncios
            ->  BitmapOr (idx_anuncios_busca_trgm, idx_anuncios_titulo_trgm, idx_anuncios_busca_trgm)
Execution Time: 1.686 ms
```

Quatro contagens (categoria, tipo, condição, UF) saem de **uma** varredura via
`GROUPING SETS`. Quatro `GROUP BY` separados reexecutariam o filtro quatro vezes.

#### (6) Autocomplete — `?q=rolam`

```
->  Append (UNION ALL de 4 fontes, cada uma com LIMIT 6)
      ->  Bitmap Index Scan on idx_anuncios_titulo_trgm (rows=338)
      ->  ... categorias / marcas / maquinas (tabelas pequenas)
Execution Time: 1.827 ms
```

---

## 5. Facetas — sim, elas existem, e o custo foi contido

Contar por categoria é uma agregação sobre o conjunto **inteiro** de
resultados, enquanto a lista é uma janela de 20 linhas. Não dá para tirar as
duas da mesma linha de retorno sem repetir o agregado completo em cada uma das
20 linhas.

A decisão foi:

- **endpoint separado** (`/facetas`), não um campo a mais na busca — quem não
  desenha a coluna de filtros não paga pela agregação;
- **cache com a assinatura do recorte sem paginação** — folhear 10 páginas
  dispara a agregação uma vez;
- **`GROUPING SETS`** — quatro contagens numa varredura só;
- a faceta de categoria **ignora o filtro de categoria** (e a de tipo, o de
  tipo). Contar categorias já filtrado por uma categoria devolveria uma linha
  só, que é inútil na tela: o número existe para o usuário decidir para onde ir.

Medido: **1,7 ms** para um recorte de 338 anúncios.

---

## 6. Log de busca e termos populares

### `busca_logs` — sempre pela fila

Gravar em `busca_logs` é um INSERT por busca, na rota mais chamada do sistema.
No caminho da resposta, dobraria o número de idas ao banco da operação mais
frequente do produto — e o usuário estaria esperando por uma gravação que não
muda nada na tela dele. O `enfileirar` é um push no Redis; o INSERT acontece no
worker, e o `catch` no controller é vazio de propósito: se a fila cair, a busca
continua respondendo e o que se perde é uma linha de estatística.

Regras de qualidade do dado:

- **só a página 1 é registrada.** Paginar não é uma nova busca; contar cada
  página multiplicaria o termo no ranking pelo número de páginas folheadas, e o
  topo viraria "o termo com mais resultados" em vez de "o mais procurado".
- **busca sem termo e sem filtro nenhum não é registrada** — é a home
  carregando, não intenção de compra.

**LGPD:** `ip_hash` (nunca o IP em claro), `sessao_hash` (hash da sessão, ou o
hash do IP para visitante anônimo). `usuario_id` só quando há login. O log cru
é descartado após **180 dias** pelo job — o agregado fica.

### `termos_populares` — job de hora em hora

A home pergunta "o que é mais procurado hoje" a cada visita. Responder varrendo
`busca_logs` cru seria um `GROUP BY` na tabela que mais cresce, na página que
mais recebe acesso.

O job (`busca.agregarTermosPopulares`, cron `5 * * * *`) usa **DELETE + INSERT
do dia**, não `ON CONFLICT`. Motivo: o índice único é
`(data, termo_normalizado, uf)` e `uf` é anulável; no Postgres NULL nunca é
igual a NULL num índice único, então o `ON CONFLICT` jamais casaria para busca
sem UF — que é a maioria — e cada execução duplicaria as linhas em silêncio.
Reescrever o dia dentro de uma transação é idempotente e barato.

O job também reprocessa **ontem**: uma busca feita às 23h59 pode ser gravada
pelo worker às 00h00 e ficaria fora dos dois agregados.

A leitura (`GET /termos-populares`) usa janela de **7 dias** por padrão, não
"hoje": às 8h da manhã o agregado do dia tem meia dúzia de linhas e a seção da
home apareceria vazia todo começo de dia.

`termoService.semResultado()` existe mas **não tem rota pública**: a lista de
buscas sem resultado é a lista de compras da plataforma (demanda existente sem
oferta, usada para decidir qual lojista convidar). Publicá-la entregaria o mapa
dos buracos do catálogo para o concorrente. Fica disponível para o módulo de
Admin/relatórios chamar.

---

## 7. Segurança e privacidade

**Injeção de SQL.** Nenhum valor vindo do usuário entra no texto da consulta.
Todo valor passa por `binds.add()`, que devolve `$n` e guarda o valor para o
driver — é `bind` do Sequelize, parametrização no protocolo do Postgres, não
escape de string. O texto do SQL é 100% literal escrito no código. `testes/busca.test.js`
dispara cinco vetores (`' OR 1=1 --`, `'; DROP TABLE anuncios; --`,
`%' UNION SELECT senha_hash FROM usuarios --`, `pg_sleep`, `1' OR '1'='1`) em
`q`, `cat` e `cidade`, e confere depois que a tabela continua existindo e que
nenhum anúncio sumiu.

**Só anúncio publicado.** `a.removido_em IS NULL AND a.status = 'publicado'`
são as duas primeiras linhas do `WHERE`, sem condicional nenhuma — é o que
impede um rascunho de vazar por um filtro esquecido.

**`exibir_whatsapp`.** O número só entra na resposta com consentimento, e a
chave **some por inteiro** em vez de vir `null` — para não induzir o front a
montar um link `wa.me` vazio.

**`exibir_endereco_exato`.** Padrão do produtor é `false`: ele anuncia de casa,
e devolver a coordenada exata da propriedade num JSON público é entregar o
endereço de quem tem maquinário no pátio. Quando é falso, sai a sede do
município com `aproximada: true` — sinal que o front usa para desenhar círculo
em vez de alfinete.

**Nunca expostos:** `descricao` (nem por privacidade, por peso), `documento`,
`email`, `usuario_id`, `senha_hash`, `ip_hash`. Não estão no `SELECT` e não
estão no mapper.

**Teto de paginação em duas camadas.** O validador recusa `pp > 35` com 422
explicando; `lerPaginacao` no service trunca em 35 de qualquer forma. Duas
camadas porque a segunda protege quem chamar o service direto (de um job, por
exemplo), onde o validador não passa.

**Rate limit por rota, com tetos diferentes** porque o custo é diferente: busca
120/min, facetas 60/min (agregação), sugestões 240/min (chamada a cada tecla),
populares 300/min (quase sempre do cache).

---

## 8. Pendências e dependências

### Precisa do orquestrador

1. **Montar a rota.** `src/routes/index.js` é arquivo proibido para este
   módulo. Falta:
   ```js
   router.use('/v1/busca', require('../features/busca/busca.routes'));
   ```
   O teste registra a rota em tempo de execução para poder rodar.

2. **Índice geográfico ausente** (não crio migration por contrato). A busca por
   proximidade **sem termo** cai em Seq Scan porque não existe índice em
   `anuncios (latitude, longitude)`. Sugerido:
   ```sql
   CREATE INDEX idx_anuncios_geo ON anuncios (latitude, longitude)
   WHERE removido_em IS NULL AND status = 'publicado';
   ```
   Com termo, o índice trigrama já carrega o filtro e o caso está resolvido
   (8 ms, §4.4).

3. **Fila própria para a busca** (opcional). `busca.registrarLog` está na fila
   `INDEXACAO`, que já é a das rotinas de busca. Se o volume de log crescer a
   ponto de atrasar a reindexação de anúncio, vale um `FILAS.BUSCA` em
   `src/filas/definicoes.js`.

4. **RBAC.** Nada a acrescentar em `src/rbac/recursos.js` — todas as rotas são
   públicas. Quando o Admin quiser a tela de "buscas sem resultado", o recurso
   `relatorio.busca` (que já existe) cobre.

### Arquivos compartilhados que este módulo tocou

- `src/filas/index.js` — uma linha: `require('./trabalhos/busca.trabalho')`.
- `worker.js` — uma linha no array `PERIODICOS`, agendando
  `busca.agregarTermosPopulares` com cron `5 * * * *`.

### Dependência do módulo `localizacao` (em construção em paralelo)

`busca.localizacao.service.js` resolve o ponto de origem por coordenada,
município ou cidade. Para **CEP**, ele carrega
`../localizacao/localizacao.cep.service` de forma **opcional**: se o módulo
existir e exportar `porCep(cep)` devolvendo
`{ latitude, longitude, municipioId?, uf?, cidade? }`, o CEP passa a funcionar
sozinho. Enquanto não existe, o CEP não resolve e a busca simplesmente ignora a
proximidade — o front já converte CEP em cidade pelo ViaCEP e manda `cidade`,
então nada quebra na tela.

Pedir "ordenar por mais próximo" sem informar de onde devolve **400**, e não
uma lista em ordem qualquer: o usuário veria resultados e acharia que são os
mais próximos dele.

### Dúvidas de produto registradas

1. **`tipo=maquina` não existe.** O escopo pedia filtro por tipo
   "peça/serviço/máquina", mas `ANUNCIO_TIPO` no schema é
   `['peca', 'servico', 'procura']`. Implementei o vocabulário do schema.
   Máquina é filtrada por **compatibilidade** (`?maquina=<slug>`, via
   `anuncio_maquinas`), que é o "Busque por máquina" descrito no model. Se a
   cliente quiser máquina como tipo de anúncio (vender o trator, não a peça),
   isso é uma migration no enum e uma decisão de produto.
2. **Facetas de faixa de preço** (histograma) não foram feitas: exigem
   `width_bucket` sobre o recorte inteiro e o front hoje usa slider livre, sem
   contadores. Fácil de acrescentar ao `GROUPING SETS` quando a tela pedir.
3. **`preco_a_combinar` como terceiro estado.** Assumi que a faixa de preço
   exclui "a combinar" e que `?aCombinar=true` traz só esses. É o comportamento
   que faz sentido na tela, mas não está escrito em `Maturacao/05`.
