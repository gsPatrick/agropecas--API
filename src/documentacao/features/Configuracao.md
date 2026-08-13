# Configuração

Parâmetros de **produto** que a Admin muda na tela, sem deploy: limites, prazos,
textos e chaves de funcionalidade. É o módulo que entrega a "flexibilidade
total" pedida pela cliente — e é também o módulo do qual quase todos os outros
dependem, então o contrato dele é mais rígido que o dos demais.

## Configuração ≠ config

| | `src/config` | `Configuracao` (este módulo) |
|---|---|---|
| origem | `.env` / variável de ambiente | tabela `configuracoes` |
| muda em runtime? | não (exige restart) | sim, vale em segundos |
| quem muda | quem opera o servidor | a Admin, pela tela |
| exemplos | porta, segredo do JWT, string do banco | dias de validade do anúncio, WhatsApp do suporte |

**Segredo nunca vira configuração.** Parte desta tabela é servida sem
autenticação e o resto é lido por qualquer feature; uma credencial aqui é uma
credencial com muitas portas.

---

## Arquivos

```
src/features/configuracao/
  index.js                          API interna — é o que as outras features importam
  configuracao.routes.js            mapa da feature
  configuracao.controller.js        só HTTP
  configuracao.validators.js        esquemas de entrada
  configuracao.mapper.js            objeto interno → JSON (lista branca)
  configuracao.constants.js         tipos, lista branca pública, TTL
  configuracao.cache.js             chaves de cache da feature
  configuracao.leitura.service.js   mapa em cache, obter/obterVarias/listar/publicas
  configuracao.escrita.service.js   definir/definirVarias, auditoria, invalidação
  configuracao.tipo.service.js      converte na leitura, valida na escrita
  configuracao.historico.service.js consulta a trilha em logs_auditoria
```

---

## API interna — o que importa para os outros módulos

```js
const configuracao = require('../configuracao');

const dias    = await configuracao.obter('anuncio.dias_validade', 60);
const moderar = await configuracao.booleano('anuncio.moderacao_previa', false);
const fotos   = await configuracao.numero('anuncio.max_fotos', 8);

// lote: UMA consulta, nunca uma por chave
const { fotos, chat } = await configuracao.obterVarias({
  fotos: ['anuncio.max_fotos', 8],
  chat:  ['chat.ativo', true],
});
```

Três garantias, e elas são o motivo de o módulo existir:

1. **`obter` nunca lança.** Chave ausente, banco fora, cache corrompido: devolve
   o padrão e registra um aviso (uma vez por chave, para não inundar o log).
   Configuração faltando não pode derrubar a publicação de um anúncio.
2. **Volta já tipado.** Número volta número, booleano volta booleano. Se você
   escreveu `Number(await configuracao.obter(...))`, o bug é aqui — reporte, não
   contorne.
3. **O padrão é parte da chamada.** Quem chama sabe o valor seguro do seu caso;
   este módulo não sabe.

---

## Endpoints

Prefixo: `/api/v1/configuracoes`

| Método | Rota | Permissão | O que faz |
|---|---|---|---|
| GET | `/publicas` | — (aberta) | Só a lista branca. Um objeto `{ chave: valor }` já tipado. |
| GET | `/` | `configuracao.ler` | Todas, com tipo/grupo/descrição. `?grupo=` filtra. |
| GET | `/:chave` | `configuracao.ler` | Uma configuração. 404 se não existir. |
| GET | `/:chave/historico` | `configuracao.ler` | Trilha paginada (de → para, autor, motivo). |
| PUT | `/:chave` | `configuracao.editar` | Altera uma. 404 se a chave não existir. |
| PUT | `/` | `configuracao.editar` | Altera um lote em transação (`{ itens: [{ chave, valor }] }`). |

Rate limit: `rateLimit.leitura()` na pública (é chamada em todo carregamento do
front) e `rateLimit.escrita()` nas duas rotas de escrita.

---

## Todas as configurações

| Chave | Tipo | Padrão | Pública | Grupo | O que faz |
|---|---|---|---|---|---|
| `anuncio.dias_validade` | número | `60` | não | anuncio | Dias até o anúncio expirar sozinho. |
| `anuncio.max_fotos` | número | `8` | **sim** | anuncio | Fotos por anúncio. O front precisa para travar o upload antes de subir. |
| `anuncio.moderacao_previa` | booleano | `false` | não | anuncio | Exige aprovação do Admin antes de publicar. Saber que existe moderação é informação de moderação — não vai para o front. |
| `anuncio.max_ativos_por_usuario` | número | `null` | não | anuncio | Limite de anúncios ativos. `null` = ilimitado (mesma convenção dos limites de plano). |
| `chat.ativo` | booleano | `true` | **sim** | chat | Liga/desliga o chat interno. O front precisa para esconder o botão. |
| `chat.admin_le_somente_com_denuncia` | booleano | `true` | não | chat | LGPD: Admin só abre conversa mediante denúncia. Regra interna de privacidade, não se anuncia. |
| `contato.whatsapp_suporte` | texto | `5565999999999` | **sim** | contato | WhatsApp do suporte exibido no rodapé. |
| `contato.email_suporte` | texto | `contato@agropecasmt.com.br` | **sim** | contato | E-mail do suporte exibido no rodapé. |
| `localizacao.produtor_aproximada` | booleano | `true` | não | privacidade | Produtor nasce com localização aproximada. Expor a regra ajudaria quem quer descobrir a exceção. |

Os padrões acima são os do seed (`seeders/20260810000000-rbac-e-base.js`). O
valor **corrente** é o do banco — a tabela documenta a intenção original.

---

## Decisões

### A lista branca da rota pública mora no código, não no banco

A coluna `publica` existe e é respeitada, mas **sozinha ela não libera nada**. A
rota aberta serve uma chave só se ela estiver em `PUBLICAS`
(`configuracao.constants.js`) **e** tiver `publica = true`. As duas condições.

Motivo: a coluna é editável. Um `UPDATE` errado numa madrugada, ou uma tela de
admin com um checkbox mal rotulado, transformaria
`chat.admin_le_somente_com_denuncia` em dado aberto sem que ninguém percebesse.
A lista branca no código exige um commit e uma revisão. A coluna continua útil
no sentido restritivo: a Admin pode **fechar** uma chave pública sem deploy.

O teste `publica=true no banco NÃO fura a lista branca do código` existe
exatamente para impedir que alguém "simplifique" isso um dia.

### Nenhuma seleção por convenção de nome

Nada de "tudo que começa com `publico.` é público". Quem cria a chave daqui a
seis meses não vai lembrar da convenção, e o erro só aparece depois do vazamento.

### PUT em chave inexistente é 404, não `upsert`

Uma tabela de configuração que aceita chave nova por PUT vira lixeira:
`anuncio.max_foto` (sem o "s") convive em paz com `anuncio.max_fotos`, o código
continua lendo a chave certa enquanto a Admin edita a errada — e nada na tela
indica o problema. Chave nova entra por seed/migration, com tipo e descrição.

### Tipo validado na escrita, convertido na leitura

A coluna é JSONB: o banco aceita qualquer coisa em qualquer chave. Sem esta
camada, `anuncio.dias_validade` viraria a string `"60"` no dia em que alguém
salvasse pelo formulário (HTML manda tudo como texto), e o módulo de anúncio
faria a conta errada sem estourar erro nenhum. Bug caro justamente por ser mudo.

A escrita é estrita — só uma flexibilidade: texto que é número puro (`"60"`) é
aceito em campo numérico e normalizado, porque é o caso real do `<input>`. Texto
arbitrário continua 422. A leitura é tolerante, para não quebrar com dado legado.

`null` é sempre válido, em qualquer tipo: no vocabulário do sistema significa
"sem limite / não definido", como nos limites de plano.

### Cache: uma chave para a tabela inteira, TTL de 30s

Um `lembrar` guarda o **mapa completo** (`cache.chaves.configuracoes()`), não uma
chave por configuração. São poucas dezenas de linhas; buscar tudo numa consulta e
servir da memória custa menos que gerenciar N chaves — e invalidar vira uma
operação atômica em vez de N remoções que podem falhar pela metade e deixar o
cache incoerente.

O TTL curto **não é a estratégia**: a escrita invalida explicitamente, e como o
cache usa Redis quando disponível, a invalidação vale para todas as instâncias.
Os 30s são a rede de segurança para o cenário degradado (Redis fora no instante
exato da escrita) — é o maior atraso que aceitamos aí.

A invalidação acontece **antes** de responder ao PUT: a Admin muda um limite e
recarrega a tela no segundo seguinte; se o valor antigo ainda aparecesse, ela
clicaria em salvar de novo achando que não pegou.

### Histórico não tem tabela própria

A trilha já é gravada em `logs_auditoria` pela escrita. Uma
`configuracoes_historico` seria uma segunda fonte da verdade que um dia diverge.
`GET /:chave/historico` é só a consulta filtrada por
`entidade = 'configuracoes'` + `entidade_id`.

A `acao` gravada é `editar` (não `configuracao.alterada`) porque a coluna é um
ENUM do Postgres com vocabulário fechado — ver pendências.

### O que o mapper não deixa sair

`bruto` (o valor como está no JSONB) fica fora: expor os dois formatos convida o
front a escolher o errado. No histórico, `ip_hash` e `user_agent` ficam fora —
estão na trilha para investigação, não para exibição, e são dado pessoal de um
funcionário.

---

## Pendências e o que precisa dos arquivos compartilhados

1. **`src/routes/index.js`** — falta a linha (o módulo não pode editar o arquivo):
   ```js
   router.use('/v1/configuracoes', require('../features/configuracao/configuracao.routes'));
   ```
   Enquanto isso, `testes/configuracao.test.js` sobe a mesma pilha de middlewares
   num servidor próprio, e passa a usar o app real assim que a linha existir.

2. **`AUDITORIA_ACAO`** (`src/models/constantes.js`, ENUM no banco) não tem um
   valor para "configuração alterada". Usamos `editar`, que junto com
   `entidade = 'configuracoes'` é inequívoco. Se um dia a trilha ganhar filtro
   por ação na tela do Admin, vale uma migration acrescentando `configurar`.

3. **`app.js`** poderia chamar `configuracao.preaquecer()` no boot, para que a
   primeira requisição não pague a consulta. Não é bloqueante — o `lembrar`
   resolve na primeira leitura.
