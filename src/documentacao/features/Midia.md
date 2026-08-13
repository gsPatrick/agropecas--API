# Mídia

Upload e processamento de imagem. É o módulo que alimenta as fotos de anúncio,
a foto de perfil e a capa — tudo que o usuário sobe passa por aqui e vira uma
linha em `arquivos`.

---

## 1. Estrutura

```
src/features/midia/
  midia.routes.js                 mapa da feature
  midia.controller.js             só HTTP
  midia.recepcao.middleware.js    parser multipart (multer em memória)
  midia.validators.js             campos de texto do multipart e da query
  midia.mapper.js                 model → JSON (lista branca) + status derivado
  midia.constants.js              tipos aceitos, assinaturas, variantes, pastas
  midia.inspecao.service.js       porteiro: magic bytes, tamanho, dimensões
  midia.upload.service.js         grava o original e enfileira
  midia.processamento.service.js  gera as variantes (roda no worker)
  midia.consulta.service.js       listagem e detalhe
  midia.remocao.service.js        remove do disco e marca no banco
  midia.limpeza.service.js        faxina de órfãos e reprocessamento pendente
  midia.armazenamento.service.js  ponte para providers/storage (+ leitura)

src/filas/trabalhos/midia.trabalho.js   midia.processar · midia.limparOrfaos
```

Nenhum service passa de ~200 linhas e nenhum deles conhece `req`/`res` — é o
que permite que `midia.processamento.service.js` seja o corpo de um job e
`midia.upload.service.js` possa ser chamado por um script de importação.

---

## 2. Endpoints

Prefixo: `/api/v1/midia` (a montagem em `src/routes/index.js` é do
orquestrador — ver §7).

| Método | Rota   | Permissão         | Limite            | O que faz |
|--------|--------|-------------------|-------------------|-----------|
| POST   | `/`    | `arquivo.enviar`  | 30 / 10min / conta | Recebe 1..N imagens, grava o original, enfileira o processamento. `201` com status `processando`. |
| GET    | `/`    | escopo de `arquivo.remover` | leitura | Lista paginada dos arquivos alcançáveis. Filtros: `referenciaTipo`, `referenciaId`, `usuarioId` (Admin), `pagina`, `porPagina`. |
| GET    | `/:id` | escopo de `arquivo.remover` | leitura | Detalhe com as URLs das três variantes. |
| DELETE | `/:id` | `arquivo.remover` | escrita | Apaga do storage (original + variantes) e marca a linha. `204`. |

Todas exigem autenticação.

**Upload.** `multipart/form-data`, campo `arquivos` (ou `arquivo` para envio
único), mais os campos de texto opcionais `referenciaTipo`
(`anuncio` · `perfil_foto` · `perfil_capa`) e `referenciaId` (UUID).

Resposta de um item:

```json
{
  "id": "…", "url": "…/midia/originais/2026/08/<uuid>.jpg",
  "mime": "image/jpeg", "tamanhoBytes": 184320,
  "nomeOriginal": "trator-frente.jpg",
  "status": "processando",
  "variantes": { "thumb": null, "media": null, "grande": null },
  "referencia": null, "descartarEm": null, "criadoEm": "…"
}
```

---

## 3. As decisões que valem explicação

### O processamento nunca acontece na resposta

Gerar três variantes de uma foto de celular custa de 300ms a 2s de CPU. Com dez
fotos por anúncio, isso é o anunciante olhando para um spinner enquanto o
processo web fica sem núcleo para servir quem está navegando. O upload faz só o
que é barato — conferir, gravar, enfileirar — e devolve o registro na hora com
`status: "processando"`. **O front já pode exibir a imagem**, usando a `url` do
original, e troca para a variante quando ela aparecer.

### Status é derivado, não armazenado

A tabela `arquivos` não tem coluna de estado e migration não é deste módulo.
O status sai de "existem as três variantes?" — o que, além de resolver o
problema imediato, tem a vantagem de nunca divergir da realidade do disco, que é
o destino de toda coluna de status que alguém esquece de atualizar.

### Variante é linha na mesma tabela

Cada variante entra em `arquivos` com `referencia_tipo = 'midia_variante'` e
`referencia_id` apontando para o original. Isso mantém o inventário completo
(é o que permite cumprir pedido de exclusão do titular sobre *todos* os bytes),
torna o job idempotente (basta olhar quais rótulos já existem) e evita uma
tabela nova. O rótulo (`thumb`/`media`/`grande`) vive no caminho, que é montado
só por este módulo: `midia/variantes/<idDoOriginal>/<rotulo>/<uuid>.webp`.

### WebP nos três tamanhos, original preservado

O gargalo real do front é peso de imagem no 4G do interior de MT; o mesmo
enquadramento sai ~30% menor em WebP que em JPEG. Os tamanhos são 320 (grade de
resultados), 800 (card e carrossel do celular) e 1600 (ampliação — a única tela
onde alguém repara em detalhe de uma peça). Cada variante extra é CPU no worker
e espaço para sempre, então são três e não seis. O original fica como veio para
que trocar de formato amanhã não exija pedir a foto de novo ao anunciante.

### EXIF descartado

O `.rotate()` aplica a orientação e o pipeline não copia metadados. Além de a
foto sair em pé, some o GPS que o celular grava por padrão — foto de peça não
precisa publicar a coordenada da fazenda de quem anunciou.

### Sem cache

A listagem é por usuário e muda a cada upload e a cada remoção. Uma foto que
some da grade só ao expirar o TTL é exatamente o "bug" que ninguém consegue
reproduzir, e o ganho de cachear uma consulta indexada e paginada por
`usuario_id` não paga a invalidação que ela exigiria.

### 403 e não 404 no arquivo alheio

O §11.5 do padrão pede que 404 e 403 sejam indistinguíveis para recurso de
terceiro. Aqui a escolha foi consciente na direção oposta: o id é UUIDv4, não é
adivinhável nem enumerável por sequência, então o ganho contra varredura seria
nulo — e o 403 diz ao anunciante que a imagem existe e é de outra pessoa, o que
evita chamado de suporte sobre "sumiu minha foto".

### Remoção apaga o byte, não o registro

`arquivos` é `paranoid`. O que some de verdade é o conteúdo no storage — que é
o dado pessoal. A linha fica como rastro de que aquele arquivo existiu, de quem
era e quando saiu, que é o que responde a "provem que apagaram". A ordem é disco
primeiro, banco depois: uma queda no meio deixa linha apontando para arquivo
inexistente (inofensivo); a ordem inversa deixaria byte sem nenhuma linha que o
encontre, que é lixo permanente.

### Órfãos: duas etapas

O órfão nasce de um comportamento normal — a pessoa sobe seis fotos enquanto
preenche o formulário e desiste. Apagar assim que o prazo vence pegaria quem
subiu a foto, foi almoçar e voltou. Por isso `midia.limparOrfaos` **marca**
`descartar_em` (24h sem vínculo) numa rodada e **executa** na rodada seguinte,
depois de outras 24h de carência. Vincular o arquivo a qualquer momento limpa a
marca.

---

## 4. Segurança

| Vetor | Tratamento |
|---|---|
| Tipo falsificado | Assinatura binária (`midia.constants.js`), nunca `mimetype` nem extensão. Aceita apenas JPEG, PNG, WebP. A extensão no disco é a que corresponde aos bytes lidos. |
| Arquivo poliglota | O formato que o decodificador reconhece precisa bater com a assinatura; divergência é recusa. |
| SVG | Fora da lista. É XML, aceita `<script>`/`<foreignObject>` e servido do mesmo domínio vira XSS armazenado. |
| Tamanho | `limits.fileSize` do multer corta durante a leitura do socket (o arquivo grande nunca chega inteiro à memória) e a inspeção confere de novo. Padrão 8MB. |
| Quantidade | `limits.files` + conferência no service. Padrão 10 por requisição. Há teto também de `fields`, `parts` e `fieldSize`. |
| Path traversal | O nome do disco é UUID gerado pelo `providers/storage`. O `originalname` só é guardado para exibição, já reduzido ao basename e limpo de caractere de controle. `midia.armazenamento.js` recusa qualquer caminho que resolva fora da pasta de upload — inclusive vindo do banco. |
| Bomba de descompressão | Dimensões lidas do **cabeçalho** (`metadata()`, sem decodificar) antes de gravar: teto de 12.000px por lado e 40MP. No job, `limitInputPixels` repete a trava para arquivo antigo ou reprocessamento manual. |
| Força bruta / abuso | Rate limit por **conta** no upload (30 / 10min): no interior de MT a revenda inteira sai pelo mesmo IP de operadora. |
| Escopo | `exigir(ctx, 'arquivo.remover', { donoId })` no service, onde o dono é conhecido. Listagem usa `filtroDeEscopo` na consulta. Nenhum `if (papel === 'admin')`. |
| LGPD | Remoção administrativa grava em `logs_auditoria` (`acao: remover`, `entidade: arquivos`). EXIF/GPS descartado no processamento. |

---

## 5. Filas

| Trabalho | Fila | Quando |
|---|---|---|
| `midia.processar` | `MIDIA` (conc. 3) | A cada upload, com `chaveUnica` por arquivo. |
| `midia.limparOrfaos` | `MIDIA` | Periódico, `30 3 * * *` (registrado em `worker.js`). |

`midia.processar` é idempotente: cada rótulo existe no máximo uma vez e o que já
está lá é pulado. É isso que torna seguro retentar e permite à faxina
reenfileirar qualquer arquivo em dúvida sem checagem prévia.

`midia.limparOrfaos` faz três coisas na mesma janela: marca órfãos, descarta os
que passaram da carência e **reenfileira o que ficou sem variante** — a rede de
segurança para o caso de o Redis estar fora no instante do upload ou de o worker
morrer no meio.

---

## 6. Configuração

Todas com padrão sensato; nenhuma é obrigatória.

| Variável | Padrão | Para quê |
|---|---|---|
| `MIDIA_MAX_BYTES` | `8388608` | Teto por arquivo. |
| `MIDIA_MAX_ARQUIVOS` | `10` | Teto por requisição. |
| `MIDIA_MAX_PIXELS` | `40000000` | Anti-bomba de descompressão. |
| `MIDIA_MAX_DIMENSAO` | `12000` | Teto por lado. |
| `MIDIA_ORFAO_HORAS` | `24` | Sem vínculo por este tempo → marcado. |
| `MIDIA_ORFAO_CARENCIA_HORAS` | `24` | Carência entre marcar e apagar. |
| `MIDIA_ORFAOS_POR_RODADA` | `200` | Lote da faxina. |

Reaproveita `STORAGE_DRIVER`, `STORAGE_LOCAL_PATH` e `STORAGE_PUBLIC_URL`.

---

## 7. Pendências conhecidas

1. **Rota não montada.** `src/routes/index.js` é do orquestrador. Falta
   `router.use('/v1/midia', require('../features/midia/midia.routes'));`
2. **`arquivo.ler` não existe no RBAC.** A leitura usa hoje o escopo de
   `arquivo.remover`, que responde a mesma pergunta ("sobre quais arquivos esta
   pessoa tem alcance") mas é semanticamente torto. Falta a ação em
   `src/rbac/recursos.js`, com escopos `proprio`/`todos`.
3. **`arquivo.enviar` só tem escopo `proprio`.** Não há como um Admin enviar em
   nome de outro usuário (existe `anuncio.criar_em_nome_de` para o análogo de
   anúncio). Se o poder de intervenção do Admin precisar valer aqui, falta o
   escopo `todos`.
4. **`providers/storage` não expõe leitura.** O job precisa dos bytes do
   original; enquanto o provider não tiver `ler()`, isso mora em
   `midia.armazenamento.service.js` e conhece o driver local. Quando o S3
   entrar, é o único ponto a mudar.
5. **Falha permanente não tem estado.** Um arquivo cujo processamento falha em
   todas as tentativas fica em `processando` para sempre (a faxina reenfileira,
   o que resolve falha transitória mas não corrupção). Uma coluna de estado ou
   uma contagem de tentativas resolveria — depende de migration.
6. **Largura e altura não são persistidas.** A tabela `arquivos` não tem as
   colunas (`anuncio_fotos` tem). São lidas na inspeção e descartadas; a API não
   as expõe.
7. **Vínculo pós-upload.** Hoje o vínculo só pode vir no próprio upload
   (`referenciaTipo`/`referenciaId`). Quem vai vincular a foto depois é o módulo
   de anúncio, escrevendo em `arquivos` ou em `anuncio_fotos` — a divisão entre
   as duas tabelas precisa ser combinada com aquele módulo.
8. **`npm test` não inclui esta suíte** (`package.json` é do orquestrador).
   Rodar com `node testes/midia.test.js`.
