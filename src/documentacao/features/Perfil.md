# Perfil

O rosto público do usuário: **Produtor Rural**, **Loja de Peças** e
**Prestador de Serviços**. Os três são o **mesmo registro** em `perfis`, com
`tipo` como discriminador — não são entidades separadas (ver
`src/models/perfil.js` e `Maturacao/05_perfis_e_funcoes.md` §2).

O perfil **já existe** quando este módulo entra em cena: quem o cria é
`auth.registro.service.js`, na mesma transação da conta, porque usuário sem
perfil não anuncia nem aparece. Este módulo cuida do que acontece **depois**:
ver, editar, publicar e verificar.

---

## 1. Estrutura de arquivos

```
src/features/perfil/
  perfil.routes.js                mapa da feature
  perfil.controller.js            só HTTP
  perfil.validators.js            esquemas de entrada
  perfil.mapper.js                model → JSON (lista branca; é aqui que a LGPD acontece)
  perfil.constants.js             campos por tipo, coleções, TTLs, vocabulários
  perfil.cache.js                 chaves e invalidação
  perfil.consulta.service.js      detalhe do perfil (cache, escopo, LGPD)
  perfil.listagem.service.js      vitrine paginada com filtros
  perfil.edicao.service.js        edição e remoção (soft delete)
  perfil.verificacao.service.js   selo do Admin — o único caminho para `verificado_em`
  perfil.horario.service.js       horário de funcionamento (loja e prestador)
  perfil.vinculo.service.js       serviços, marcas e área de atendimento (N:N)
```

**Por que `vinculo` é um service só para três coleções:** serviço, marca e
município são a mesma mecânica — conjunto de ids com colunas extras na tabela
de ligação. Três arquivos quase idênticos garantiriam que, no dia da correção,
só um dos três fosse corrigido. O que varia é dado, e vive em
`perfil.constants.js` (`COLECOES`).

---

## 2. Endpoints

| Método | Rota | Permissão | Observação |
|---|---|---|---|
| `GET` | `/api/v1/perfis` | **pública** | listagem paginada, filtros e cache |
| `GET` | `/api/v1/perfis/:slug` | **pública** | página do perfil; aceita também um UUID |
| `GET` | `/api/v1/perfis/meu` | `perfil.ler` | visão completa do titular |
| `PATCH` | `/api/v1/perfis/meu` | `perfil.editar` | escopo `proprio` basta |
| `GET` | `/api/v1/perfis/meu/horarios` | `perfil.ler` | |
| `PUT` | `/api/v1/perfis/meu/horarios` | `perfil.editar` | substitui a semana inteira |
| `DELETE` | `/api/v1/perfis/meu/horarios/:dia` | `perfil.editar` | `dia` = 0..6, 0 = domingo |
| `GET` | `/api/v1/perfis/meu/:colecao` | `perfil.ler` | `servicos` · `marcas` · `area-atendimento` |
| `PUT` | `/api/v1/perfis/meu/:colecao` | `perfil.editar` | substitui o conjunto |
| `POST` | `/api/v1/perfis/meu/:colecao` | `perfil.editar` | vincula um item |
| `DELETE` | `/api/v1/perfis/meu/:colecao/:alvoId` | `perfil.editar` | desvincula |
| `PATCH` | `/api/v1/perfis/:id` | `perfil.editar` **escopo `todos`** | edição por terceiro; auditada |
| `DELETE` | `/api/v1/perfis/:id` | `perfil.remover` | soft delete; dono ou Admin |
| `POST` | `/api/v1/perfis/:id/verificacao` | `perfil.verificar` | dá o selo; observação obrigatória |
| `DELETE` | `/api/v1/perfis/:id/verificacao` | `perfil.verificar` | revoga o selo |

Todas as capacidades já existiam em `src/rbac/recursos.js` — **nenhuma
permissão nova foi necessária**. `perfil.verificar` só tem escopo `todos`, e é
por isso que ninguém verifica o próprio cadastro.

Escopo é conferido **no service**, com `exigir(ctx, acao, { donoId })`, porque
só depois de buscar o registro se sabe de quem ele é. O middleware `autorizar`
cobre a capacidade; o escopo é do service. Ver `PADRAO_MODULO` §4.

---

## 3. As regras da cliente, e onde elas moram no código

### 3.1 No perfil aparece **só WhatsApp** (`Maturacao/05` §8.2.1)

O chat interno nasce de um **anúncio**, nunca de um perfil: é o anúncio que dá
contexto à conversa, permite moderar com referência e evita contato solto — que
é por onde o spam começa.

Consequência prática, em `perfil.mapper.js`:

- o perfil público **não** devolve `telefoneSecundario`, `emailPublico` nem
  `aceitaChat`;
- `aceitaChat` existe na visão privada (o dono precisa configurar), mas não
  aparece na pública, para que nenhum front seja tentado a desenhar um botão de
  chat na página do perfil;
- o perfil **não** devolve endereço nem mapa: localização é atributo do anúncio.
  O máximo que sai é município e UF.

### 3.2 `exibir_whatsapp` é consentimento LGPD, não preferência de UI

Com `false`, o número **não sai da API** — nem no detalhe, nem na listagem, nem
quando o mapper é chamado de dentro do `include` de outra feature. A decisão
está numa função só (`whatsappVisivel`), usada por `publico()` e `item()`.

A exceção é o próprio titular: em `/perfis/meu` o número aparece mesmo com o
consentimento desligado, porque o que o consentimento controla é a **publicação**
do dado, não o acesso do titular ao que ele mesmo cadastrou.

### 3.3 `exibir_endereco_exato` nasce `false`

O produtor anuncia de casa (§9.3). Como o perfil não expõe endereço de forma
alguma, hoje a flag só é lida por quem montar a tela de anúncio — este módulo
apenas permite ao titular alterá-la.

### 3.4 `documento` (CPF/CNPJ) nunca sai em rota pública

Sai apenas para o dono e para quem tem escopo `.todos`. No segundo caso,
`perfil.consulta.service.detalhar()` grava em `logs_acesso_dado` **antes** de
montar a resposta: abrir dado pessoal de terceiro é *acesso*, não *alteração*,
e a auditoria comum (`logs_auditoria`) não registraria isso.

`inscricao_estadual` também ficou fora da visão pública: é dado fiscal, não
identidade comercial. `razao_social` e `nome_fantasia` continuam públicos —
são o nome da loja.

---

## 4. Decisões que valem explicação

### 4.1 O slug é imutável — **trava**, não redirecionamento

`GET /perfis/:slug` é a página que o Google indexa e o link que circula em grupo
de WhatsApp. Mudar o slug quebraria todos esses links.

Havia dois caminhos: **redirecionar** (guardar o slug antigo e responder 301) ou
**travar**. Ficou travado, por dois motivos:

1. redirecionar exige uma coluna de histórico (`slug_anterior`) ou uma tabela de
   redirects — e **migrations são território do orquestrador**, não deste módulo;
2. travar é reversível: o dia em que a coluna existir, dá para liberar a troca.
   O contrário não é — link quebrado não volta.

Na prática: `slug` não está em nenhum esquema de entrada, e está em
`CAMPOS_BLOQUEADOS`. Trocar `nomeExibicao` **não** mexe no slug. Nem o Admin
troca — o que é limitação consciente, registrada em §7.

### 4.2 Auto-verificação é impossível por construção, não por checagem

`verificado_em` e `verificado_por` **não existem em nenhum esquema desta
feature**. O validador descarta campo desconhecido (`.strip()`), então
`{"verificadoEm": "..."}` some antes de chegar ao service. Mesmo assim, os dois
campos estão em `CAMPOS_BLOQUEADOS` e a escrita deles só acontece dentro de
`perfil.verificacao.service.js`, onde:

- `verificado_por` é sempre `contexto.usuarioId`;
- `verificado_em` é sempre `new Date()` do servidor;
- nenhum argumento da requisição influencia qualquer um dos dois.

Três barreiras para o mesmo vetor porque este é o campo que transforma um perfil
qualquer em "verificado pela plataforma" aos olhos de quem vai negociar.

### 4.3 Campo de um tipo não vaza para outro

Os três tipos dividem a tabela. Sem filtro, um produtor gravaria
`inscricao_estadual` e uma loja apareceria com `area_hectares`. O mapa
`CAMPOS_POR_TIPO` é o filtro, aplicado em `montarPatch()`.

O campo de outro tipo é **descartado em silêncio**, não recusado: o front manda
o formulário inteiro, e recusar transformaria um detalhe de implementação em
erro de usuário. Para não virar "salvei e não gravou", a resposta traz
`meta.camposIgnorados`.

### 4.4 A UF vem do município

`municipio_id` é o que o cliente manda; `uf` é derivada dele no servidor. Aceitar
as duas do cliente abriria divergência entre a cidade e o estado — e é exatamente
`uf` que a listagem filtra.

### 4.5 Horário: `PUT` da semana inteira

Horário de funcionamento é lido como bloco ("seg a sex 8-18, sáb 8-12"). Editar
dia a dia deixaria a tela num estado intermediário inconsistente entre dois
salvamentos. O `DELETE /:dia` existe para o caso pontual ("fechei aos domingos").

A constraint `ck_horario_coerente` já está no banco. A mesma regra é conferida
no service **antes** do INSERT — não por desconfiança do banco, mas porque
violação de CHECK volta como erro de driver e o usuário receberia 500 em vez de
"informe o horário de abertura". A constraint continua sendo a garantia real
contra corrida e contra escrita fora da API.

### 4.6 "Revenda autorizada" não é autodeclarável

`perfil_marcas.autorizada` é um selo comercial que só vale se alguém conferiu o
contrato de representação. Se o lojista pudesse marcá-lo sozinho, o selo não
significaria nada. Em `perfil.vinculo.service.js`, extras listados em
`somenteAdmin` são descartados de quem não tem `perfil.verificar`.

### 4.7 404 e 403 indistinguíveis em recurso alheio

`PATCH /perfis/:id` e `DELETE /perfis/:id` respondem **404** quando o perfil não
é seu e você não tem escopo — não 403. Distinguir os dois transformaria a rota
num oráculo de "este id existe?" (`PADRAO_MODULO` §11.5).

---

## 5. Performance

- **Cache do perfil público** (`perfil.cache.js`), TTL **300s**. É a rota mais
  lida do sistema, o conteúdo é idêntico para todo visitante e muda pouco. O que
  vai para o cache é o objeto **já mapeado** — nunca instância do Sequelize — e
  já sem os campos que o consentimento esconde, de modo que um bug futuro no
  controller não consiga ressuscitar um dado que o mapper removeu.
- **Cache da listagem**, TTL **60s**, com `cache.assinatura(filtros)` na chave.
  Mais curto porque perfil novo precisa aparecer rápido na busca.
- **Invalidação na escrita**: toda operação que grava chama
  `perfilCache.invalidar(perfil)`, que remove o detalhe pelo slug e derruba a
  listagem inteira. A listagem cai inteira porque qualquer campo pode participar
  de um filtro; invalidar seletivamente exigiria conhecer todas as assinaturas
  existentes. TTL é rede de segurança, não estratégia.
- **Sem N+1**: horários, serviços, marcas e área de atendimento vêm em `include`
  na mesma consulta (`INCLUDES_DETALHE`). Nenhum laço com `findByPk` dentro.
- **Listagem** com `attributes` explícito (fora `bio` e `entrega_observacao`,
  que são `TEXT` e a tela de resultados não usa), teto de 50 por página
  (`lerPaginacao`) e `subQuery: false` para os filtros por N:N virarem
  `INNER JOIN` resolvido pelo índice único da tabela de ligação.
- **Contadores são coluna.** `total_visualizacoes` é incrementado com um
  `UPDATE` atômico disparado **sem `await`**, fora do caminho da resposta.
  Nenhum `COUNT(*)` por requisição.
- **Índices**: os filtros (`tipo`, `municipio_id`, `uf`, `slug`) batem com os
  índices já declarados no model. A exceção é `q` — ver §7.

---

## 6. Segurança

1. **Escopo sempre no servidor**, via `exigir()`/`pode()`. Nenhum
   `if (papel === 'admin')` no módulo.
2. **Nada de id vindo do corpo**: o dono sai de `perfil.usuario_id`, o ator de
   `contexto.usuarioId`.
3. **Rate limit** em toda rota de escrita (`rateLimit.escrita()`) e nas duas
   rotas públicas de leitura (`rateLimit.leitura()`), que são as raspáveis.
4. **Auditoria** (`logs_auditoria`) em edição, remoção, verificação e revogação
   do selo. Quando quem age não é o dono, `em_nome_de` guarda o titular — é o
   rastro que o poder amplo do Admin exige (`Maturacao/05` §2.4).
5. **`logs_acesso_dado`** na leitura de perfil completo de terceiro.
6. **Teto de itens** por coleção (200): sem ele, um `PUT` com 5.000 municípios
   viraria uma listagem pública que nenhum cache salva.

---

## 7. Pendências e o que precisa do orquestrador

**Precisa ser aplicado por quem cuida dos arquivos compartilhados:**

1. `src/routes/index.js` — registrar a feature:
   ```js
   router.use('/v1/perfis', require('../features/perfil/perfil.routes'));
   ```
   Enquanto isso não acontece, `testes/perfil.test.js` monta o router no
   agregador antes de exigir o `app` (há um comentário no teste explicando).
2. `package.json` — script `"test:perfil": "node testes/perfil.test.js"` e
   inclusão no `test`.

**Decisões em aberto (precisam da cliente ou de outro módulo):**

3. **Troca de slug pelo Admin.** Hoje ninguém troca. Liberar exige coluna
   `slug_anterior` (ou tabela de redirects) + resposta 301 na rota pública —
   e migration é do orquestrador.
4. **Slugs reservados.** `SLUGS_RESERVADOS` existe em `perfil.constants.js`, mas
   quem gera slug é `auth.registro.service.js` (arquivo protegido) e ele não
   consulta a lista. Hoje o conflito é resolvido pela ordem das rotas (`/meu`
   antes de `/:slug`), o que basta; se um perfil "meu" for criado, ele fica
   inacessível pela URL pública. Correção real: `slugDisponivel()` recusar a
   lista de reservados.
5. **Busca por nome (`?q=`)** usa `iLIKE %termo%`, que não usa índice. Enquanto a
   base é pequena, resolve. Se a busca de perfil virar caminho quente, precisa de
   `pg_trgm` + índice GIN, ou de uma coluna `nome_exibicao_normalizado` — as duas
   coisas são migration.
6. **Edição de `documento` (CPF/CNPJ).** Este módulo **não** permite alterar o
   documento, nem para o Admin: é o campo que identifica a pessoa e cuja troca
   deveria passar por reverificação. Se o suporte precisar corrigir um CPF
   digitado errado, isso deveria ser um endpoint próprio, com auditoria
   específica. **Pergunta para a cliente / orquestrador.**
7. **Visualização do próprio dono conta como visualização.** Descontar exigiria
   `usuario_id` no objeto cacheado, que foi deixado de fora de propósito. Quando
   existir a tela de métricas, o ajuste vira job.
8. **`total_anuncios` e `total_anuncios_ativos`** são lidos daqui mas escritos
   pelo módulo de anúncio (por job). Este módulo nunca os recalcula.
9. **`endereco_id`** existe no model mas não é editável aqui — endereço é
   assunto do módulo de endereço/anúncio, e o perfil não exibe endereço (§8.2.1).

---

## 8. Testes

`testes/perfil.test.js`, no formato das suítes de auth (rodam contra a API e o
banco de verdade, com `testes/apoio.js`). **76 verificações, 0 falhas.**

Vetores de segurança cobertos, marcados com `[SEG]` na saída:

- perfil público não expõe `documento`, `documentoTipo` nem `pessoaTipo` — e o
  CPF não aparece como texto em nenhum lugar da resposta;
- `exibir_whatsapp = false` remove o número da resposta pública (e o dono
  continua vendo o seu);
- editar/remover perfil alheio não passa **e não grava**;
- `verificadoEm`/`verificadoPor` no corpo são ignorados, e usuário comum
  chamando a rota de verificação recebe 403 sem o selo mudar;
- campo de outro tipo de perfil não é gravado (conferido direto no banco);
- `autorizada` não é autodeclarável;
- slug não muda pelo corpo nem ao trocar o nome de exibição — o link antigo
  continua respondendo 200.

---

## 9. Culturas, maquinário, serviços e endereço no `PATCH /perfis/meu`

*(migration `20260815000100-perfil-culturas-e-maquinario.js`)*

O painel salva o formulário **inteiro** num PATCH — não faz uma chamada por
coleção. Até aqui isso significava três buracos silenciosos: culturas e
maquinário não tinham tabela, `perfil_servicos` existia mas nenhuma rota de
escrita do cadastro a alimentava, e o endereço do formulário era descartado
menos o município. A pessoa via a confirmação de "salvo" e o dado sumia.

### Tabelas

| Tabela | Papel |
|---|---|
| `culturas` | vocabulário (soja, milho, algodão, gado…), no padrão de `servicos` |
| `perfil_culturas` | pivô, único por `(perfil_id, cultura_id)`, com índice em `cultura_id` |
| `perfil_maquinas` | frota do produtor: `marca_id` **opcional** + `marca_nome` sempre preenchido |

**Por que vocabulário e não array de texto:** a pergunta que o dado responde é
"quem planta soja em Sorriso?". Em texto livre, "Soja", "soja" e "soja
transgênica" são três respostas para a mesma pergunta e nenhuma encontra as
outras — o produtor some da busca achando estar cadastrado. Array de UUID
resolveria a grafia mas não daria FK, contador por cultura nem o join que a
listagem pública já faz com `perfil_servicos`.

**Por que a marca da máquina aceita texto livre:** regra de produto. Quem tem
implemento de metalúrgica da região precisa conseguir cadastrar; FK obrigatória
recusaria exatamente o equipamento que ninguém cataloga. Com marca do catálogo,
`marca_id` aponta e a busca "quem tem John Deere" é join; sem, sobra o texto — e
o Admin consegue promover os textos mais repetidos a marca depois.

### Entrada aceita

```jsonc
PATCH /perfis/meu
{
  "culturas": ["Soja", "milho-safrinha", "<uuid>"],   // rótulo, slug ou id
  "servicos": ["reparo-de-cilindro", "Retífica de motor"],
  "maquinas": [{ "tipo": "trator", "marca": "John Deere", "modelo": "6110J", "ano": 2018 }],
  "endereco": { "cep": "...", "logradouro": "...", "numero": "...",
                "complemento": "...", "bairro": "...", "referencia": "..." }
}
```

`POST /auth/registrar` aceita `municipioId` e o mesmo bloco `endereco` (o
esquema é **o mesmo objeto**, importado de `perfil.validators`).

### Decisões

- **Item fora do catálogo é 422, não criação.** Aceitar qualquer texto faria o
  vocabulário deixar de ser fechado em uma semana.
- **Uma transação para tudo.** Campos, endereço e as três coleções: gravar metade
  do formulário é o pior resultado possível, porque é silencioso.
- **Serviços e culturas sincronizam por diferença**, não destroy+insert:
  recriar perderia `preco_referencia_centavos`/`principal` que o prestador
  preencheu na outra tela. Maquinário substitui (a linha não tem extra a
  preservar), mas mantém a linha cujo `id` é UUID vindo da API.
- **Culturas e maquinário são do produtor**; mandados por outro tipo, entram em
  `meta.camposIgnorados`, como qualquer campo exclusivo de tipo. Serviços valem
  para os três — `PUT /perfis/meu/servicos` nunca restringiu por tipo e divergir
  criaria duas regras para o mesmo dado.
- **Endereço**: `endereco_id` continua bloqueado no corpo (ninguém aponta o
  próprio perfil para o endereço de outra pessoa); quem escreve é o servidor. O
  contrato de dono não mudou — o endereço não tem dono, o perfil tem, e a
  permissão é verificada antes, em `perfil.edicao`. Coordenada não vem do
  formulário: é a sede do município, e ponto exato só pelo mapa da feature de
  localização, que deriva `precisao` da origem.
- **`endereco` na resposta**: público traz bairro/município/UF; logradouro,
  número, complemento, CEP e referência só para o titular e escopo `.todos`.

### Pendências

- Não há `GET /catalogo/culturas`: exporia o vocabulário ao front sem ele ter de
  manter a lista. Precisa de rota na feature de catálogo — **não criada** para
  não conflitar com quem estiver escrevendo aquele módulo.
- `perfil_culturas.area_hectares` e `principal` existem mas nenhuma tela os
  preenche ainda.
- `total_produtores`/`total_prestadores` são atualizados por delta na escrita; um
  job de reconciliação ainda não existe.
