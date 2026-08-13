# Feature `conversa`

Chat interno do AgroPeças, com entrega em tempo real. Conversa **por anúncio**,
mensagem, contador de não lidas, arquivamento, encerramento, bloqueio entre
usuários e remoção de mensagem para moderação.

```
src/features/conversa/
  conversa.routes.js               mapa da feature: rota, limite, permissão, validação
  conversa.controller.js           só HTTP — lê req, chama service, devolve
  conversa.validators.js           esquemas de entrada
  conversa.mapper.js               model → JSON, lista branca (o mais sensível do sistema)
  conversa.constants.js            tetos, limites e vocabulário de auditoria

  conversa.acesso.service.js       porteiro: participação, moderação, bloqueio
  conversa.inicio.service.js       abrir conversa a partir de um anúncio
  conversa.consulta.service.js     caixa de entrada (a tela mais aberta do app)
  conversa.historico.service.js    mensagens de uma conversa, por cursor
  conversa.mensagem.service.js     enviar e marcar como lida (+ tempo real e notificação)
  conversa.estado.service.js       arquivar (pessoal) e encerrar (da conversa)
  conversa.moderacao.service.js    remoção de mensagem (soft delete + auditoria)
  conversa.bloqueio.service.js     bloquear, desbloquear, listar
```

Não existe `conversa.service.js`: envio de mensagem e política de bloqueio não
têm nada em comum além do domínio, e juntá-los produziria o arquivo que ninguém
mais abre.

---

## 1. Endpoints

Base: `/api/v1/conversas` — **tudo autenticado** (`router.use(autenticar)` na
primeira linha do router).

| Método | Rota | Permissão | O que faz |
|---|---|---|---|
| `POST` | `/` | `conversa.criar` | Inicia (ou devolve) a conversa de um anúncio |
| `GET` | `/` | `conversa.ler` | Caixa de entrada paginada (`?pagina&porPagina&arquivadas`) |
| `GET` | `/nao-lidas` | `conversa.ler` | Total do balão (soma da coluna) |
| `GET` | `/:id` | `conversa.ler` | Cabeçalho da conversa |
| `GET` | `/:id/mensagens` | `conversa.ler` | Histórico por cursor (`?limite&antesDe`) |
| `POST` | `/:id/mensagens` | `conversa.responder` | Envia mensagem |
| `POST` | `/:id/ler` | `conversa.ler` | Zera o contador e carimba os recibos |
| `POST` | `/:id/arquivar` | `conversa.arquivar` | Some da minha caixa de entrada |
| `DELETE` | `/:id/arquivar` | `conversa.arquivar` | Desarquiva |
| `POST` | `/:id/encerrar` | `conversa.encerrar` | Encerra para os dois |
| `DELETE` | `/mensagens/:id` | `mensagem.remover` | Soft delete da mensagem |
| `GET` | `/bloqueios` | `bloqueio.gerenciar` | Meus bloqueios |
| `POST` | `/bloqueios` | `bloqueio.gerenciar` | Bloqueia um usuário |
| `DELETE` | `/bloqueios/:usuarioId` | `bloqueio.gerenciar` | Desbloqueia |

As rotas `/bloqueios` e `/mensagens/:id` são declaradas **antes** de `/:id` —
na ordem inversa, `/bloqueios` cairia na rota de detalhe e morreria na
validação de uuid.

---

## 2. A regra da cliente (Maturacao/05, §8)

1. **O chat é por ANÚNCIO, não por perfil.** `conversas.anuncio_id` é
   obrigatório. Não existe endpoint para "conversar com o perfil X": no perfil
   aparece apenas o WhatsApp. O anúncio é o que dá contexto à mensagem, permite
   à moderação julgar com referência e evita o contato solto, por onde o spam
   entra num classificado.
2. **Quem não está logado não conversa.** O front já trata; a API é quem
   garante.
3. **`perfis.aceita_chat = false` desliga o chat**, e aí só resta o WhatsApp. A
   checagem vale para conversa NOVA; thread já aberta continua respondível —
   desligar o chat é recusar contato novo, não abandonar quem já estava
   falando.
4. **Duas pessoas + um anúncio = uma conversa.** A segunda tentativa devolve a
   existente (com `200`, não `201`). O interessado que volta ao anúncio três
   dias depois precisa reencontrar o histórico.

> A pasta `Maturacao/` não está neste repositório; a regra foi seguida a partir
> do enunciado e dos comentários dos models (`conversa.js` cita §8.2.1). Vale
> conferir contra o documento original antes de publicar.

---

## 3. Segurança

**Participação é conferida em TODA operação**, inclusive na paginação de
mensagens — que é justamente onde a checagem costuma ser esquecida, porque "a
conversa já foi aberta antes". O ponto único é
`conversa.acesso.service.exigirParticipacao`.

**404, nunca 403, para conversa alheia.** Responder 403 confirmaria que o id
existe, e um laço sobre uuids devolveria o mapa das conversas do sistema. Quem
não participa recebe a mesma resposta de quem inventou um id — testado.

**A sala do WebSocket é decidida no servidor.** O handler de `conversa:entrar`
(em `src/tempo-real/adaptadores/socketio.js`) consulta
`conversa_participantes` antes de aceitar; os nomes de sala saem de
`src/tempo-real/salas.js`. Nenhum service desta feature monta string de sala na
mão nem confia em id vindo do cliente.

**Bloqueio vale nos dois sentidos.** Decisão registrada: bloquear significa
"não quero contato com esta pessoa", e contato é mão dupla. Se só o sentido
bloqueador→bloqueado valesse, quem foi bloqueado continuaria abrindo conversa e
escrevendo — exatamente o que a vítima quis evitar. Se só o sentido inverso
valesse, bastaria bloquear alguém para ficar imune ao próprio bloqueio. O preço
aceito é que o bloqueio corta a via para os dois lados; a tela avisa antes de
confirmar. Conferido a cada **envio**, não só na abertura: quem bloqueia no
meio do papo espera que a próxima mensagem não chegue.
A mensagem de erro é idêntica nos dois sentidos — dizer "você foi bloqueado"
entregaria a informação de que a outra pessoa bloqueou.

**Dado de contato.** O WhatsApp da outra parte só sai quando o perfil dela tem
`exibir_whatsapp = true` — é consentimento LGPD, não preferência de UI, e vale
igual dentro do chat. Documento (CPF/CNPJ), e-mail, telefone secundário e
endereço nunca entram no payload da conversa: o `attributes` do `include` em
`conversa.consulta.service.js` já não os traz do banco, e o mapper é lista
branca.

**Rate limit por CONTA, não por IP** (`porUsuario` em `conversa.routes.js`): 30
mensagens/min e 10 inícios de conversa/min. No interior de MT a região inteira
sai pelo mesmo IP de operadora — limitar por IP puniria uma cidade por causa de
um spammer.

**Auditoria** (`logs_auditoria`) em remoção de mensagem, bloqueio,
desbloqueio e encerramento. `logs_auditoria.acao` é um ENUM de VERBOS genéricos
no banco (`criar`, `editar`, `remover`…); quem diz sobre o quê é `entidade`.
Os apelidos do chat estão em `conversa.constants.ACAO` — valor fora do enum é
recusado pelo Postgres e a auditoria se perde em silêncio.

**Leitura pela moderação** (`conversa.ler.todas`) grava em `logs_acesso_dado`
uma linha para **cada um dos dois titulares**, a cada abertura.

---

## 4. Paginação por cursor — por que não offset

Entre carregar a página 1 e pedir a página 2, uma mensagem nova entra no topo,
tudo desce uma posição e a primeira linha da página 2 é a que o usuário já
tinha lido — a anterior a ela **some da tela para sempre**. O cursor aponta
para uma LINHA, não para uma posição, então inserção concorrente não desloca
nada. Há teste que insere uma mensagem entre as duas páginas e confere.

O cursor é composto (`criado_em` + `id`), codificado em base64url e opaco:

- **composto** porque duas mensagens no mesmo milissegundo (um envio duplicado
  por retry, por exemplo) empatariam com cursor só de data e uma delas se
  perderia na virada de página;
- **opaco** porque expor `criado_em` cru convidaria o cliente a montar o valor
  na mão, e aí mudar a ordenação viraria mudança de contrato.

Cursor corrompido devolve a primeira página em vez de 500: paginação quebrada
não é falha de servidor. Teto de 100 por página, padrão 30.

---

## 5. Performance

**A caixa de entrada roda em duas consultas** (o `COUNT` da paginação e a
lista), independentemente de quantas conversas existam — medido, não estimado.
O caminho ingênuo custaria `1 + 3N`, e esta é a tela mais aberta do produto.

O que torna isso possível:

| Dado | Onde mora | Por quê |
|---|---|---|
| prévia da última mensagem | `conversas.ultima_mensagem_previa/_em/_de` | a lista nunca toca em `mensagens` |
| não lidas | `conversa_participantes.nao_lidas` | `COUNT(*)` por conversa a cada abertura de tela é o clássico que só aparece quando o histórico cresce |
| outra parte e anúncio | `include` (`belongsTo`/`hasOne`) | LEFT JOIN, sem duplicar linha e sem laço |

A consulta parte de `conversa_participantes`, não de `conversas`: o filtro é
sempre "as minhas", e o índice parcial `idx_participantes_nao_lidas`
(`usuario_id`, `nao_lidas`) atende esta tela e o balão. Ordenação por
`ultima_mensagem_em DESC NULLS LAST` — conversa recém-aberta ainda não tem
mensagem e não pode encabeçar a lista à frente de quem acabou de escrever.

`nao_lidas` é mantido com `increment`/`decrement`, que viram
`nao_lidas = nao_lidas + 1` **no banco**: dois envios simultâneos somam dois.
Ler, somar em JavaScript e gravar perderia um.

O envio grava em três tabelas dentro de **uma transação** (mensagem, conversa,
participante) e a emissão em tempo real não faz nenhuma consulta extra: tudo
que vai no evento já está em memória desde a gravação.

**Sem cache.** Chat é o oposto do caso de cache: escrita constante, leitura
sempre da linha mais nova, e uma prévia desatualizada por um segundo é bug
visível. Por isso a feature não tem `conversa.cache.js`.

---

## 6. Conteúdo da mensagem e XSS

Teto de **2000 caracteres** — quem precisa de mais está usando o chat como
e-mail, e `TEXT` sem teto é convite para encher a tabela mais quente do sistema.
Aplicado no validador e de novo no service (o service é chamável pela fila, sem
passar pelo middleware).

`limparConteudo` remove caracteres de controle (invisíveis, usados para
disfarçar conteúdo e para quebrar log) e limita linhas em branco em sequência.

**A API não escapa HTML, e isso é decisão consciente.** Ela guarda e devolve
texto puro em JSON; **é o front que escapa ao renderizar** — em React/Next isso
é o comportamento padrão de `{texto}`, e o contrato é: *nenhum consumidor pode
injetar o conteúdo com `dangerouslySetInnerHTML` ou `innerHTML`*. Escapar na
gravação transformaria "peça < 5mm" em `peça &lt; 5mm` no banco, o dano seria
permanente e um segundo consumidor (app nativo, exportação de dados) receberia
texto já mexido.

---

## 7. Remoção de mensagem — divergência anotada

`removida_em` em vez de DELETE: quem apaga uma mensagem não pode apagar a prova
de que ela existiu, senão a denúncia de abuso chega à moderação sem base.

O comentário de `src/models/mensagem.js` diz que "o conteúdo é substituído".
**Aqui o conteúdo permanece na coluna e quem o troca por "Mensagem removida." é
o mapper.** Apagar o texto no banco destruiria justamente a evidência que a
moderação precisa ler depois — e a proteção contra vazamento tem que existir no
mapper de qualquer jeito, para mensagem removida por terceiro. O expurgo
definitivo é assunto do job de retenção da LGPD, não do clique do usuário.
Se a decisão do produto for outra, muda-se `conversa.moderacao.service.js` num
lugar só.

Se a mensagem removida era a última, a prévia da caixa de entrada é reescrita —
senão o texto sairia da conversa e ficaria exposto na lista.

---

## 8. Tempo real

Eventos usados (todos já existentes em `src/tempo-real/eventos.js` — **nenhum
evento novo foi acrescentado**):

| Evento | Quando | Para onde |
|---|---|---|
| `MENSAGEM_NOVA` | envio | sala da conversa **e** sala do destinatário |
| `MENSAGEM_LIDA` | marcar como lida | sala da conversa e sala de quem enviou |
| `CONVERSA_ATUALIZADA` | encerramento e remoção de mensagem | sala da conversa |

São duas salas no envio de propósito: a da conversa alcança quem está com a
tela aberta (inclusive as outras abas do próprio remetente); a do destinatário
alcança o badge da caixa de entrada quando ele está em outra tela.

**Grava, depois emite, depois notifica.** O evento é entrega complementar,
nunca o registro do fato: se o WebSocket estiver fora, a mensagem já está no
banco e aparece quando a tela abrir. Inverter produziria a pior falha possível
num chat — o balão aparece na tela do outro e some no F5.

**Notificação só para quem não está conectado** (`tempoReal.conectados(id)`):
avisar quem está com a tela aberta é ruído, o balão já apareceu. Contrato fixo,
combinado com o módulo `notificacao`:

```js
await filas.enfileirar('notificacao.criar', {
  usuarioId, tipo: 'mensagem_nova', titulo, mensagem,
  dados: { conversaId }, entidade: 'conversas', entidadeId: conversaId,
  canais: ['sistema'],
});
```

---

## 9. Pendências conhecidas

- **O router não está montado.** A linha de `/v1/conversas` em
  `src/routes/index.js` continua comentada — arquivo que esta feature não pode
  editar. Até o orquestrador descomentar, os endpoints não existem em produção;
  a suíte de teste monta um app próprio para não depender disso.
- **`notificacao.criar` ainda não existe** em `src/filas/trabalhos/`. O
  `enfileirar` já é feito no formato combinado; hoje o adaptador registra
  "trabalho desconhecido" no log e segue. Passa a funcionar sozinho quando o
  módulo `notificacao` registrar o trabalho.
- **Anexos.** `mensagens` tem colunas de anexo e `MENSAGEM_TIPO` prevê
  `imagem`/`arquivo`, mas só `texto` é aceito por enquanto: upload precisa de
  validação de magic bytes e cota, que é assunto do módulo de mídia.
- **`conversa.bloquear.todas`** (moderação bloquear conversa por abuso) não tem
  endpoint aqui — parece pertencer ao painel de moderação, junto de denúncia.
- **Mensagem de sistema** (`tipo: 'sistema'`, ex.: "anúncio pausado") tem
  suporte no model e no mapper, mas nenhum produtor ainda.
- `conversa.bloqueio.service.idsBloqueadosPara(usuarioId)` está exportado para
  que a busca e a listagem de anúncios escondam quem bloqueou — quem construir
  essas telas deve usá-lo em vez de reescrever a regra.
