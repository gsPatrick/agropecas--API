# LGPD

Direitos do titular (Lei 13.709/2018, arts. 18 e 19), documentos legais
versionados e anonimização de conta. É o módulo que protege a plataforma
juridicamente — e o único cujo defeito aparece primeiro num processo, não num
relatório de erro.

> Escrito por quem desenvolve. Os prazos e as bases legais precisam de revisão
> jurídica antes de ir ao ar — ver "Lacunas" no fim.

---

## Estrutura

```
lgpd.solicitacao.service.js    fila de pedidos do titular e o relógio dos 15 dias
lgpd.exportacao.service.js     reautenticação, confirmação por código, enfileiramento
lgpd.pacote.service.js         montagem do arquivo de dados (só o job chama)
lgpd.anonimizacao.service.js   substituição do identificável, preservando o vínculo
lgpd.documento.service.js      versões de Termos/Política e detecção de desatualizado
lgpd.consentimento.service.js  visão do TITULAR (quem grava é o auth)
lgpd.link.service.js           link temporário de uso único (usado também pela auditoria)
lgpd.constants.js  lgpd.cache.js  lgpd.mapper.js  lgpd.validators.js
lgpd.controller.js  lgpd.routes.js  index.js
```

O registro de consentimento **não está aqui**: ele nasceu em
`features/auth/auth.consentimento.service.js` porque o primeiro aceite acontece
no cadastro. Duplicar a escrita garantiria que um dia as duas divergissem sobre
qual base legal atribuir. Este módulo lê e cuida do resto.

## Endpoints

Prefixo `/api/v1/lgpd`.

| Método | Rota | Permissão |
|---|---|---|
| GET | `/documentos` | **público** |
| GET | `/documentos/:tipo` | **público** |
| GET | `/consentimentos` | autenticado (próprio) |
| GET | `/consentimentos/pendencias` | autenticado (próprio) |
| POST | `/solicitacoes` | `lgpd.solicitar` (escopo próprio) |
| GET | `/solicitacoes/minhas` | autenticado |
| GET | `/solicitacoes` | `lgpd.ler_solicitacoes` |
| GET | `/solicitacoes/resumo` | `lgpd.ler_solicitacoes` |
| GET | `/solicitacoes/:id` | dono ou `lgpd.ler_solicitacoes.todas` |
| PATCH | `/solicitacoes/:id` | `lgpd.responder_solicitacao` |
| POST | `/exportacoes` | `usuario.exportar_dados` + **senha** |
| POST | `/exportacoes/confirmar` | `usuario.exportar_dados` + **código** |
| POST | `/exportacoes/titular` | `usuario.exportar_dados.todos` |
| GET | `/downloads/:token` | link de uso único, do dono |
| POST | `/anonimizacao` | `usuario.remover` (própria) / `usuario.anonimizar` (alheia) |
| POST | `/documentos` | `lgpd.publicar_documento` |
| GET | `/documentos-historico` | `lgpd.publicar_documento` |
| GET | `/panorama-consentimentos` | `lgpd.ler_solicitacoes` |

Jobs: `lgpd.exportarDados`, `lgpd.anonimizar`, `lgpd.expurgar` (periódico).

---

## Decisões que valem explicação

### O prazo de 15 dias nasce com a solicitação

A LGPD tem dois prazos no art. 19: **imediato** para a confirmação simples de
existência de tratamento e **15 dias** para a declaração completa. Adotamos 15
dias corridos para toda solicitação — quem cumpre esse cumpre o outro por
consequência. Corridos e não úteis: a lei não fala em dias úteis, e contar úteis
seria escolher a interpretação mais folgada.

`prazo_em` é preenchido no ato da abertura, e a fila do encarregado é ordenada
por ele — não por data de criação. O que importa para quem atende é o que vence
primeiro. `GET /solicitacoes?vencendo=true` destaca o que entra na faixa de 3
dias; `/solicitacoes/resumo` conta abertas, vencendo e atrasadas.

**Um pedido em aberto por tipo, por titular.** Dez pedidos de acesso da mesma
pessoa não geram dez direitos, geram dez prazos correndo contra a empresa.

### O titular só pede sobre os próprios dados — e a tentativa fica registrada

`usuario_id` vem de `contexto.usuarioId`. O esquema **aceita** um `usuarioId` no
corpo de propósito: se ele apontar para outra pessoa, o RBAC nega com 403, já
que `lgpd.solicitar` só existe com escopo `proprio`. Ignorar o campo em silêncio
criaria o pedido na conta errada e esconderia a tentativa de quem lê os logs.

Solicitação alheia responde **404, não 403** — o código de erro não pode servir
para descobrir que o protocolo existe.

### Exportação exige senha **e** código

É o endpoint mais perigoso da API: entrega num arquivo só o que um atacante
levaria semanas raspando. Um token de acesso válido não basta, porque o intervalo
entre "entrei" e "peço tudo sobre mim" é exatamente a janela que uma sessão
roubada aproveita.

1. `POST /exportacoes` com a **senha** → confere (reautenticação) e envia um
   código de 6 dígitos ao e-mail cadastrado.
2. `POST /exportacoes/confirmar` com o **código** → cria o protocolo de
   portabilidade e enfileira. Resposta **202**.

Sessão roubada não vira export sem que a vítima receba o código no e-mail — e o
texto do e-mail diz explicitamente para trocar a senha se não foi ela.

A montagem **nunca** acontece no caminho da resposta: são sete tabelas de uma
conta, e as contas grandes — as que mais precisam do recurso — dariam timeout.

### O pacote é legível por gente, e não traz tudo

O art. 9º pede informação clara e adequada: as chaves saem em português, sem os
nomes internos das colunas. Um arquivo que só um desenvolvedor entende não
cumpre o direito de acesso.

**Não entra:** `senha_hash` (o titular não tem o que fazer com ele e a cópia
circularia por e-mail), `ip_hash`, `observacoes_internas`, e **mensagens escritas
pela outra parte** — o direito do art. 18 é sobre os dados do titular; entregar a
conversa inteira seria um jeito legítimo de baixar o que outra pessoa escreveu em
particular. O que consta é `mensagensQueEnviei`.

Entra também `quemAbriuMeusDados`, a partir de `logs_acesso_dado`: é a
prestação de contas que a trilha de alteração não dá.

A leitura é em blocos de 500. `findAll` sem limite numa conta de lojista antigo
mata o worker por memória.

### O link de download é temporário e de uso único

O pacote **não vai por e-mail**. Anexar tudo sobre uma pessoa a uma mensagem é
entregar o dado a qualquer servidor no caminho e deixá-lo na caixa de entrada
para sempre. O que vai é um bilhete opaco no Redis, com dono, 30 minutos de
validade e uma única utilização — o consumo acontece **antes** de ler o arquivo,
para que dois cliques simultâneos resultem em um download e um 404.

Sem cache disponível, a criação do link **falha** em vez de gerar um link eterno.

Link de outra pessoa responde 404, nunca 403: distinguir os dois transformaria o
endpoint num oráculo que confirma a existência de exports alheios.

### Exclusão é anonimização — e a integridade referencial é o ponto

Apagar a linha do usuário levaria junto anúncios e conversas em que a **outra
parte** tem interesse legítimo: o comprador que negociou uma peça perderia o
histórico da própria negociação por uma decisão que não foi dele. E há dado que a
lei manda guardar (art. 16, I e II).

A regra que orienta cada campo: **o vínculo permanece, o identificável some.**

| Fica | Some / vira marcador |
|---|---|
| `usuarios.id` e todas as FKs | nome, e-mail, telefone, WhatsApp, senha |
| anúncios (status `removido`) | documento, razão social, bio, fotos, redes, slug |
| conversas e mensagens das duas partes | endereço, coordenada |
| consentimentos (prova legal) | favoritos, notificações, preferências |
| trilha de auditoria | sessões e códigos pendentes |

Marcador e não `null`: campo vazio parece bug de migração, e a próxima pessoa que
abrir a tabela "conserta" preenchendo de volta a partir de um backup. O marcador
declara que a ausência foi decidida.

Tudo numa transação só. Uma conta meio anonimizada — perfil limpo, e-mail ainda
no ar — é pior que nenhuma, porque a plataforma passa a afirmar que atendeu o
pedido enquanto o dado continua lá.

**É irreversível.** Não existe função de desfazer neste módulo: "restaurar"
exigiria guardar em algum lugar o dado que acabamos de prometer eliminar. Por
isso a confirmação é textual (`ANONIMIZAR MINHA CONTA`), o titular reautentica
com a senha, e a ação vai para a trilha antes de executar.

O Admin não reautentica: ele já é outra pessoa agindo sobre a conta, e o que
protege ali é a auditoria, não a senha. Conta alheia exige `usuario.anonimizar`,
que só existe com escopo `todos`.

### Documento legal versionado e "consentimento desatualizado"

Sem versão e sem hash do texto, a resposta honesta a "a qual texto essa pessoa
disse sim?" é "não sei" — e aí o consentimento registrado não vale como prova.
Cada versão guarda `hash_conteudo` (SHA-256), publicado na API de propósito: é o
que permite ao titular conferir que o texto aceito é o que está no ar.

Publicar não apaga a versão anterior; ela recebe `vigente_ate`, porque os
consentimentos antigos apontam para ela. Duas escritas dependentes, uma
transação: se a segunda falhasse sozinha, o sistema ficaria sem documento vigente
e a tela de cadastro pararia.

`GET /consentimentos/pendencias` é o que o front chama no boot. Devolve, por
tipo: `nunca_aceito` ou `consentimento_desatualizado` (a versão aceita difere da
vigente), com `versaoAceita`, `versaoVigente`, `resumoMudancas` e `obrigatorio`.

Versão nova **sem** `exige_novo_aceite` é correção de vírgula: aparece como
desatualizada para a tela informar, mas não trava o uso. Só Termos e Política
podem bloquear — marketing e cookies não, porque transformar recusa em bloqueio
seria consentimento forçado, o oposto do que o art. 8º §5º permite.

Os documentos legais são **públicos, sem login**: exigir conta para ler a
política de privacidade seria exigir consentimento para saber a que se consente.

### Expurgo periódico

`lgpd.expurgar` aplica os prazos de `documentacao/models/LGPD.md` §4. O risco
maior não é apagar cedo demais, é nunca apagar e a base virar arquivo histórico
de gente que pediu para sair há três anos.

| O quê | Prazo | O que acontece |
|---|---|---|
| contas anonimizadas vencidas | `LGPD_RETENCAO_DIAS` (180) | consentimentos removidos; **a linha do usuário permanece** |
| `tentativas_login` | 90 dias | removidas |
| `busca_logs` identificados | 12 meses | `usuario_id` e `ip_hash` zerados (o termo continua útil, o vínculo não) |
| arquivos com `descartar_em` vencido | — | removidos do storage e do banco |
| `logs_auditoria` / `logs_acesso_dado` | 5 anos | removidos **por data**, nunca por ator |

A linha do usuário nunca é apagada, mesmo vencido o prazo: apagá-la quebraria as
FKs de anúncios e conversas da outra parte, que é exatamente o que a anonimização
existe para evitar.

---

## Lacunas de conformidade — para levar ao jurídico

1. **Todos os prazos precisam de validação jurídica.** 15 dias, 180 de retenção,
   90 de tentativas, 12 meses de busca, 5 anos de trilha: vieram de
   `models/LGPD.md`, que declara não ter sido escrito por advogado.
2. **Política de Privacidade ainda não existe como documento separado.** Hoje é
   seção dos Termos. `documentos_legais` já aceita o tipo; falta o texto.
3. **Os Termos não mencionam o chat interno.** O schema suporta o Admin ler
   conversa (`conversas.moderada_por` + `logs_acesso_dado.denuncia_id`), mas ler
   *só mediante denúncia* é bem mais defensável — e precisa constar nos Termos,
   que hoje são silentes. Decisão de produto pendente.
4. **Verificação de identidade do titular é a própria sessão.** Consideramos a
   sessão autenticada com e-mail confirmado como `identidade_verificada_em`.
   Pedir documento de novo seria coletar mais dado pessoal para atender a um
   pedido de privacidade — mas se o jurídico exigir verificação reforçada para
   `exclusao`/`portabilidade`, o campo já existe e o fluxo precisa de um passo.
   Hoje, conta com e-mail **não confirmado** abre solicitação com
   `identidade_verificada_em` nulo e o encarregado precisa reparar nisso na tela.
5. **Não há canal para NÃO usuário exercer direitos.** Quem nunca teve conta (ou
   já anonimizou a dele) e aparece em algum registro não tem por onde pedir.
   `solicitacoes_titular.usuario_id` é anulável e `email_solicitante` existe — o
   endpoint público falta, e ele precisa de uma verificação de identidade que não
   seja a sessão.
6. **Encarregado (DPO) não é papel.** Hoje `lgpd.responder_solicitacao.todas` só
   existe no papel `admin`, então o encarregado precisa ser Admin — o que lhe dá
   poder muito além do necessário e contraria a minimização. Falta um papel
   `encarregado` em `rbac/papeis.js`.
7. **Sem relatório de impacto (RIPD) nem registro das operações de tratamento.**
   O art. 37 pede o registro; `models/LGPD.md` §1 é o embrião dele, mas não é
   documento formal.
8. **Transferência internacional não avaliada.** Se o storage ou o provedor de
   e-mail ficarem fora do Brasil, o capítulo V se aplica e nada disso está
   endereçado.
9. **Notificação de incidente (art. 48) não tem procedimento.** Nem prazo, nem
   responsável, nem canal com a ANPD.

## Pendências técnicas

1. **Rotas não registradas.** `src/routes/index.js` é do orquestrador; falta
   `router.use('/v1/lgpd', require('../features/lgpd/lgpd.routes'))`.
2. **`lgpd.publicar_documento` vaza para todo usuário.** `propriasDoRecurso('lgpd')`
   devolve toda ação sem escopo `todos`, e o papel `usuario` a recebe — qualquer
   cadastrado publicaria uma versão dos Termos. Há uma **tranca temporária** no
   service (exige também `lgpd.responder_solicitacao`); a correção certa é em
   `rbac/recursos.js` / `papeis.js`.
3. **`TOKEN_TIPO` não tem valor para confirmação de ação sensível.** A exportação
   reaproveita `otp_login`, e `emitir` invalida os anteriores do mesmo tipo —
   pedir exportação derruba um OTP de login pendente. Precisa de migration.
4. **`AUDITORIA_ACAO` não tem `anonimizar`.** Gravado como `remover`.
5. **`auth.consentimento.service.documentosVigentes()` está quebrado**: consulta
   `where: { vigente: true }`, coluna que não existe em `documentos_legais` (o
   modelo usa `vigente_de`/`vigente_ate`). O erro é engolido por um `.catch(() => [])`,
   então **todo consentimento é gravado sem `documento_legal_id` e sem
   `versao_documento`** — ou seja, sem a prova de qual texto foi aceito, que é o
   ponto inteiro da tabela. `features/auth/` é área proibida para este módulo;
   `lgpd.documento.service.vigentes()` já faz a consulta certa e pode ser
   reaproveitado lá.
6. **`descartar_em` dos pacotes exportados é de 7 dias**, mas o link vale 30
   minutos. O arquivo fica no disco por 7 dias sem link válido — margem para
   reemissão manual, hoje inexistente como endpoint.
