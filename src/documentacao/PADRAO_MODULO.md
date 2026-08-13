# Padrão de módulo — leitura obrigatória antes de escrever qualquer feature

Este documento é o contrato. Um módulo que não o segue será rejeitado na
revisão, mesmo que funcione.

---

## 1. Estrutura de arquivos

Tudo **plano** dentro de `src/features/<nome>/`. Sem subpasta `services/`.

```
src/features/anuncio/
  anuncio.routes.js              mapa da feature
  anuncio.controller.js          só HTTP
  anuncio.validators.js          esquemas de entrada
  anuncio.mapper.js              model → JSON (lista branca)
  anuncio.constants.js           vocabulários fechados
  anuncio.criacao.service.js     um assunto
  anuncio.publicacao.service.js  outro assunto
  anuncio.consulta.service.js    outro assunto
  anuncio.metrica.service.js     outro assunto
```

**Nomeação:** `<feature>.<assunto>.service.js`. Nunca `<feature>.service.js`
com vinte funções — o arquivo que começa em criação e termina em métrica é o
que ninguém mexe seis meses depois.

Regra prática: **um service não passa de ~200 linhas**. Se passou, tem dois
assuntos dentro.

---

## 2. Fluxo obrigatório

```
routes → controller → service(s)
```

- **Controller só fala HTTP.** Lê `req`, chama service, devolve via
  `utils/resposta`. Nenhum `if` de regra de negócio, nenhuma query.
- **Service não conhece `req` nem `res`.** Recebe `contexto` (montado por
  `middlewares/contexto.js`) e dados simples. É o que permite chamá-lo de um
  job da fila.
- **Chamada HTTP externa só em `src/providers/`.** Nunca no service.

---

## 3. Validação — NUNCA importe zod

```js
const { campos, esquema } = require('../../validacao');

const criar = esquema({
  titulo: campos.texto().obrigatorio('Informe o título.').min(5).max(160),
  precoCentavos: campos.inteiro().min(0),
  categoriaId: campos.uuid().obrigatorio(),
  fotos: campos.lista(campos.uuid()),
});
```

Vocabulário completo em `src/validacao/campos.js`. Se faltar um tipo,
**reporte** — não importe a biblioteca. `npm run validacao:check` reprova.

Aplicação na rota: `validar(esquemas.criar)`, `validar.query(...)`,
`validar.params(...)`. O middleware **substitui** `req.body` pelo dado limpo.

**Ordem dos middlewares:**

```
rateLimit → autenticar → autorizar → validar → controller
```

`autorizar` antes de `validar` porque a capacidade não depende da entrada:
validar primeiro faz o servidor gastar trabalho com requisição que já seria
recusada, e devolve a quem não tem permissão um mapa do esquema (quais campos
existem, quais são obrigatórios).

Os módulos escritos até aqui validam antes de autorizar — a referência inicial
do `auth` documentava a ordem errada e todos a seguiram. **Não é vulnerabilidade**
(o 403 continua sendo aplicado), mas rotas novas devem seguir a ordem acima, e a
correção das existentes é caso a caso: em algumas a autorização depende de um
`param` já convertido, e inverter às cegas quebra.

---

## 4. Autorização — sempre pelo RBAC

```js
const { exigir, pode, filtroDeEscopo } = require('../../rbac');
```

- **Capacidade** na rota: `autorizar('anuncio.editar')`.
- **Escopo** no service, onde o dono é conhecido:
  `exigir(ctx, 'anuncio.editar', { donoId: anuncio.usuario_id })`.
- **Listagem** filtra na consulta:
  `const where = filtroDeEscopo(ctx, 'anuncio.ler', 'usuario_id')` — nunca
  buscar tudo e filtrar na aplicação.

**Proibido:** `if (usuario.papel === 'admin')`. Use `pode()`.

Se o módulo precisar de uma ação que não existe em `src/rbac/recursos.js`,
**reporte no relatório final** — não edite o arquivo (conflita com outros
módulos sendo escritos em paralelo).

---

## 5. Erros e resposta

```js
const { erros } = require('../../utils/erros');
const catchAsync = require('../../utils/catch-async');
const resposta = require('../../utils/resposta');

throw erros.naoEncontrado('Anúncio');
throw erros.semPermissao('...');
resposta.paginado(res, itens, { pagina, porPagina, total });
```

Todo handler é envolvido em `catchAsync`. Nunca `try/catch` para devolver 500 —
o middleware `erro.js` é o único tradutor.

---

## 6. Mapper — nada de instância do Sequelize na resposta

Lista branca explícita. Campo novo no banco não aparece na API sem alguém
decidir. **Nunca** exponha: `senha_hash`, `ip_hash`, `token_hash`,
`observacoes_internas`, `documento` (CPF/CNPJ) em rota pública.

Dado de contato (WhatsApp, telefone) só sai se `exibir_whatsapp` permitir —
é consentimento LGPD, não preferência de UI.

---

## 7. Cache

```js
const cache = require('../../cache');

const dados = await cache.lembrar(cache.chaves.categorias(), () => ..., { ttl: 3600 });
await cache.invalidar(cache.chaves.dominio('anuncios'));
```

- **Chave nova mora na sua feature**, em `<feature>.cache.js`, montada sobre o
  prefixo comum — assim dois módulos escritos em paralelo não disputam o mesmo
  arquivo:

  ```js
  // anuncio.cache.js
  const { base } = require('../../cache/chaves');

  const chaves = {
    detalhe: (id) => `${base()}:anuncio:${id}`,
    lista: (assinatura) => `${base()}:anuncios:lista:${assinatura}`,
    dominio: () => `${base()}:anuncio*`,
  };
  ```
- **Invalide na escrita.** TTL é rede de segurança, não estratégia.
- **Não cacheie instância do Sequelize** — só objeto simples.
- Listagem com filtro usa `cache.assinatura(filtros)` na chave.

---

## 8. Filas — nada lento no caminho da resposta

```js
const filas = require('../../filas');
await filas.enfileirar('anuncio.reindexar', { anuncioId });
```

Vai para a fila: e-mail, imagem, notificação em lote, relatório, recálculo de
contador, integração externa.

Trabalho novo = arquivo novo em `src/filas/trabalhos/<dominio>.trabalho.js`,
registrado com o namespace do módulo (`anuncio.*`, `midia.*`).

---

## 9. Tempo real

```js
const tempoReal = require('../../tempo-real');
tempoReal.paraUsuario(id, tempoReal.EVENTOS.NOTIFICACAO_NOVA, dados);
```

**Emitir nunca é o registro do fato.** Grave no banco primeiro; o evento é
entrega complementar. Se o WebSocket estiver fora, a pessoa vê ao abrir a tela.

Evento novo? Adicione em `src/tempo-real/eventos.js` e **reporte**.

---

## 10. Performance — o que será cobrado na revisão

1. **Nada de N+1.** Use `include` do Sequelize ou uma segunda consulta em
   lote. Loop com `await findByPk` dentro é rejeição automática.
2. **Paginação obrigatória** em toda listagem, com teto
   (`utils/paginacao.js` → `lerPaginacao`).
3. **`attributes`** explícito quando a tabela é larga — não traga `TEXT` que
   a tela não usa.
4. **Contador é coluna**, não `COUNT(*)` a cada requisição. Os models já têm
   `total_anuncios`, `total_visualizacoes` etc. Atualize por job.
5. **Índice existe?** O schema tem índices para os filtros previstos. Se sua
   consulta não bate com nenhum, **reporte** — não crie migration.
6. **Transação** em toda operação que escreve em duas tabelas.
7. **Bulk** para lote: `bulkCreate`, `update` com `where`, nunca laço de
   `save()`.

---

## 11. Segurança — o que será cobrado na revisão

1. **Escopo verificado no servidor**, sempre, mesmo que o front esconda o botão.
2. **Nunca confie em id vindo do corpo.** `usuario_id` sai de
   `contexto.usuarioId`, não de `req.body`.
3. **Rate limit** em rota de escrita e em rota cara
   (`rateLimit.escrita()`, `rateLimit.leitura()`).
4. **LGPD:** IP só em hash (`utils/hash.js`), acesso a dado pessoal de
   terceiro grava em `logs_acesso_dado`, ação sensível grava em
   `logs_auditoria` via `features/auditoria/auditoria.service.js`.
5. **Enumeração:** não confirme existência de recurso alheio pelo código de
   erro (404 e 403 devem ser indistinguíveis quando o recurso não é seu).
6. **Upload:** valide tipo real do arquivo (magic bytes), tamanho e
   quantidade. Nome de arquivo do cliente nunca vira caminho no disco.

---

## 12. Documentação

Um `src/documentacao/features/<Nome>.md` por módulo, com:

- estrutura de arquivos e o que cada service faz;
- tabela de endpoints (método, rota, permissão);
- **as decisões que valem explicação** — por que o cache tem esse TTL, por que
  aquele campo não é exposto, qual regra de negócio veio do documento da
  cliente;
- pendências conhecidas.

Escreva explicando **o porquê**, não o quê. Comentário que repete o código é
ruído; comentário que explica a decisão evita que alguém a desfaça sem saber.

---

## 13. Comentários no código

Em português, explicando decisão e não mecânica:

```js
/* o bloqueio é por conta e não por IP: no interior de MT a região inteira sai
   pelo mesmo IP de operadora, e bloquear IP tiraria clientes legítimos do ar */
```

Não escreva `// incrementa o contador`.

---

## 14. Regra de ouro do produto

`Maturacao/05_perfis_e_funcoes.md` é a fonte da verdade sobre o negócio. Os
três perfis (produtor, loja, prestador) **todos anunciam**, o contato é direto
(WhatsApp preferencial + chat interno), e o **Admin pode intervir em tudo** —
mas o fluxo padrão é o que a cliente definiu.

Na dúvida sobre regra de negócio: siga o documento e **registre a dúvida no
relatório final**. Não invente funcionalidade que ninguém pediu.

---

## 15. Entrega

Antes de dar o módulo por pronto:

```bash
npm run validacao:check   # nenhuma feature importa a biblioteca
npm run models:check      # models íntegros
node -e "require('./app')" # a aplicação carrega
```

E escreva `testes/<modulo>.test.js` no mesmo formato dos existentes (rodam
contra a API e o banco de verdade), cobrindo: caminho feliz, escopo negado,
validação, e o vetor de segurança específico do módulo.

**Não** edite: `src/routes/index.js`, `src/rbac/recursos.js`, `migrations/`,
`.env.example`, `package.json`. Reporte o que precisa e o orquestrador aplica.
