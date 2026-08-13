# Relatórios

Números para a cliente decidir onde investir. Três públicos, três relatórios:
o **painel geral** (Admin), o **meu desempenho** (anunciante) e o **relatório de
busca** (Admin) — este último é o que diz o que falta no catálogo.

---

## 1. Estrutura de arquivos

```
src/features/relatorio/
  relatorio.routes.js                mapa da feature
  relatorio.controller.js            só HTTP
  relatorio.validators.js            esquemas de entrada
  relatorio.mapper.js                formato de saída + geração do CSV
  relatorio.constants.js             tetos, piso de agregação, TTLs
  relatorio.comum.js                 período com teto · comparação · supressão
  relatorio.cache.js                 chaves de cache (com o escopo dentro)
  relatorio.painel.service.js        painel da plataforma (Admin)
  relatorio.desempenho.service.js    números do anunciante
  relatorio.busca.service.js         termos, termos sem resultado, filtros
  relatorio.exportacao.service.js    enfileira, lista e serve o CSV

src/filas/trabalhos/relatorio.trabalho.js
  relatorio.exportar            gera o CSV e registra o arquivo
  relatorio.agregarTermos       consolida busca_logs → termos_populares (diário)
  relatorio.limparExportacoes   apaga CSV vencido do storage
```

---

## 2. Endpoints

Prefixo sugerido: `/api/v1/relatorios`. Nada aqui é público.

| Método | Rota | Permissão | O que faz |
|---|---|---|---|
| GET | `/painel` | `relatorio.ler` | Usuários por papel e por dia, anúncios por status/categoria, conversas, contatos por canal, buscas sem resultado. |
| GET | `/desempenho` | `anuncio.ver_metricas` | Visualizações, contatos e favoritos dos anúncios do dono, com comparação com o período anterior. Aceita `usuarioId` só de quem tem escopo `todos`. |
| GET | `/busca` | `relatorio.busca` | Termos mais buscados, termos sem resultado, filtros mais usados. |
| POST | `/exportar` | `relatorio.exportar` | Enfileira a exportação. Responde **202** com protocolo. |
| GET | `/exportacoes` | `relatorio.exportar` | Exportações prontas do solicitante, com link assinado. |
| GET | `/exportacoes/:id/baixar?t=` | `relatorio.exportar` | Download, com validação da assinatura. |

Query obrigatória em todos os relatórios: **`de` e `ate`**.

### Por que `/desempenho` não exige `relatorio.ler`

`relatorio.ler` só existe com escopo `todos` — é painel de plataforma, e o
anunciante não o tem. Se a rota o exigisse, ninguém veria os próprios números.
`anuncio.ver_metricas.proprio` é justamente a permissão que o papel `usuario`
já recebe; o escopo (próprio × terceiro) é conferido no service, onde o dono é
conhecido.

---

## 3. Decisões que valem explicação

**Período obrigatório, com teto de 366 dias.** Não existe padrão "desde
sempre": um relatório sem recorte é o pedido que trava o banco, e ele nunca
chega por má-fé — chega porque o front esqueceu o filtro. 366 e não 365 porque
"o ano passado inteiro" num ano bissexto é pedido legítimo. Quem precisa de
série maior usa a exportação, cujo teto é ~3 anos porque ela roda na fila.

O teto vive em `relatorio.comum.lerPeriodo`, não nos validators: a regra
envolve a *diferença* entre dois campos, e validação de campo isolado não
enxerga relação. Estando no comum, ela vale também para o job da fila, que não
passa por middleware nenhum.

**Comparação com período anterior de mesmo tamanho.** É a única honesta.
Comparar um recorte de 10 dias com "o mês passado" produziria a queda de 70%
que não existe. Quando o período anterior é zero, `variacaoPercentual` volta
`null` (= "não havia base de comparação"), nunca `0` nem `Infinity`.

**Tudo agregado no banco.** `COUNT`, `SUM`, `GROUP BY`, `date_trunc`. Nenhuma
consulta traz linha para somar em JavaScript. As sete perguntas do painel rodam
em `Promise.all` porque são independentes — em série, o painel custaria a soma
dos tempos em vez do maior deles.

**Tabelas já agregadas.** O desempenho lê `anuncio_metricas_diarias` (uma linha
por anúncio/dia) e o relatório de busca lê `termos_populares` (uma linha por
termo/dia/UF). Varrer as tabelas transacionais para responder o mesmo ficaria
pior a cada semana de operação. `filtros mais usados` é a exceção — só existe no
log cru — mas ali a consulta é `COUNT(coluna)`, que no Postgres ignora NULL e
responde tudo numa linha.

**Cache de 5 a 10 minutos, invalidado por TTL e não por evento.** Relatório não
é painel operacional: a cliente olha número para decidir investimento, não para
reagir ao minuto. Invalidar na escrita significaria derrubar o cache do painel a
cada visualização de anúncio registrada — ou seja, cache nenhum. O job diário de
agregação invalida explicitamente, porque aí o consolidado mudou de verdade.

**O escopo entra na chave de cache.** A mesma consulta feita por dois usuários
NÃO devolve a mesma coisa. Um cache de relatório sem o dono na chave é o caminho
mais curto para entregar o número do concorrente ao usuário seguinte.

Pelo mesmo motivo, `proprio` (que depende de *quem está olhando*, não do dono
dos números) é calculado **fora** do cache. Guardá-lo junto fazia o Admin
receber o `proprio: true` gravado pela consulta do anunciante minutos antes.
Nada vazava — os números eram do mesmo dono —, mas é exatamente o mecanismo que
vazaria se um campo sensível ao leitor entrasse no payload.

**Exportação sempre pela fila.** Gerar CSV de um ano de métricas é minutos de
banco e megabytes de memória; feito na requisição, estoura o timeout do
balanceador e faz o cliente repetir o pedido, cada tentativa abrindo outra
consulta pesada. A rota só enfileira e devolve **202**. `chaveUnica` no job faz
dois cliques no botão gerarem um arquivo, não dois.

**CSV pensado para o Excel em português.** Separador `;` (com vírgula, a
planilha joga a linha inteira numa célula) e BOM UTF-8 (sem ele, os acentos
quebram). Um relatório que a cliente não consegue abrir não é um relatório.
Célula que começa com `=`, `+`, `-` ou `@` recebe um apóstrofo na frente — é o
que impede *CSV injection* virar fórmula executável na máquina dela.

---

## 4. Segurança — o que foi aplicado

**1. Escopo rigoroso.** No desempenho, o dono é resolvido **uma vez** em
`resolverAlvo` e o mesmo `usuario_id` vai para todas as somas. O `usuarioId` da
query só é honrado por quem tem escopo `todos`; para o anunciante comum, pedir o
id do vizinho dá 403 — vindo do RBAC, com a mesma mensagem de qualquer outra
negação, sem confirmar se o id existe (padrão §11.5). O filtro está no `WHERE`,
nunca num `.filter()` depois.

**2. Agregação mínima (piso 5).** Número agregado sobre uma pessoa só *não é*
número agregado — é dado pessoal com outro nome. "3 buscas por 'bomba injetora
Valtra BH180' em Nova Mutum" identifica o produtor para quem conhece a região.
Todo recorte que cruza **termo com localidade** passa por
`suprimirPequenos()`; o que não atinge o piso volta somado em `ocultados`, para
que o Admin saiba que existe cauda sem que a cauda seja revelada. A resposta
declara o piso usado em `minimoAgregacao`.

O piso **não** se aplica a contagem global de plataforma ("42 anúncios
publicados"), que não fala de indivíduo.

**3. Rate limit forte e por usuário.** 20 consultas/min para relatório e 5 por
10 min para exportação — contra as 300/min do perfil de leitura comum. Conta por
**usuário** e não por IP: no interior de MT a região inteira sai pelo mesmo IP
de operadora, e limitar por IP tiraria do ar o escritório com cinco pessoas
olhando o painel.

**4. Período com teto rígido.** §3 acima. Vale para a rota e para o job.

**5. Export por fila, com link temporário.** O CSV entra em `arquivos` com
`descartar_em` (24h). O download exige um HMAC de (arquivo · usuário ·
expiração): link vazado não vira download por outra conta. Existe/é seu/não
venceu devolvem o **mesmo 404**, para não confirmar exportação alheia. O mesmo
campo que expira o link autoriza a faxina do worker — sem ele, um CSV com o
retrato do negócio ficaria no disco para sempre.

**6. Nenhum relatório expõe pessoa física.** O painel fala em contagem por
papel, nunca em lista de usuários. Quem quiser dado individual usa a rota da
entidade, que grava `logs_acesso_dado`.

**7. Auditoria.** Todo pedido de exportação vira linha em `logs_auditoria`
(`exportar_dados` / entidade `relatorio`), com o recorte pedido.

**8. Escopo congelado no job.** O worker não tem sessão para reavaliar
permissão, então o dono autorizado é decidido na aceitação do pedido e vai
gravado no job. Sem isso, a exportação seria o caminho fácil para pegar o que a
tela recusa.

---

## 5. Jobs

| Nome | Quando | O que faz |
|---|---|---|
| `relatorio.exportar` | sob demanda | Gera o CSV, salva no storage e registra em `arquivos` com validade de 24h. |
| `relatorio.agregarTermos` | diário | `busca_logs` → `termos_populares`. Idempotente: apaga e regrava o intervalo, em transação. |
| `relatorio.limparExportacoes` | diário | Remove do storage e do banco os CSV vencidos. |

`agregarTermos` apaga e regrava em vez de usar `updateOnDuplicate` porque a
chave única é (data · termo · UF) e `uf` é anulável — no Postgres, NULL nunca
conflita com NULL, e o upsert duplicaria em silêncio toda busca sem UF a cada
reexecução. Job de agregação é o primeiro que alguém reexecuta à mão quando
desconfia do número; ele precisa ser idempotente de verdade.

---

## 6. Testes

`testes/relatorio.test.js` — 41 verificações contra a API e o banco reais.
Cobre: relatório sem permissão dá 403 (painel, busca e exportação), período
ausente dá 422 e período acima do teto dá 400, anunciante não vê número de
terceiro (403), termo com uma ocorrência é suprimido pelo piso de agregação e o
total suprimido é informado, a comparação com o período anterior bate na
aritmética, a exportação responde 202 e o CSV nasce pelo job, e link com
assinatura errada dá 404.

---

## 7. Pendências conhecidas

1. **Rotas não montadas.** Falta em `src/routes/index.js` (arquivo
   compartilhado): `router.use('/v1/relatorios', require('../features/relatorio/relatorio.routes'));`
2. **Agendamento dos jobs periódicos.** `agregarTermos` e `limparExportacoes`
   estão registrados mas ninguém os dispara. Precisam de uma entrada no
   agendador junto às rotinas de `manutencao.trabalho.js`.
3. **Sem aviso de exportação pronta.** Hoje o usuário consulta
   `GET /exportacoes`. Uma notificação exigiria template novo em
   `templates_notificacao` e um evento em `src/tempo-real/eventos.js` — os dois
   fora do alcance deste módulo.
4. **`anuncio_metricas_diarias` ainda não é alimentada.** O módulo de anúncio é
   quem grava. Enquanto ele não existir, o desempenho responde zeros — o que é
   correto, não é falha.
5. **Piso de agregação fixo em 5.** Se um recorte novo por município for
   adicionado, revisar: município pequeno de MT torna o piso mais frágil, e
   pode ser o caso de suprimir a coluna de localidade em vez da linha.
6. **Sem série por semana/mês.** `GRANULARIDADES` existe nas constantes mas só
   `dia` está implementado. Ninguém pediu ainda.
