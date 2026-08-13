# Denúncia

Canal pelo qual qualquer pessoa logada avisa a moderação de que algo está
errado — e acompanha o desfecho. É a porta de entrada da fila descrita em
[Moderacao.md](./Moderacao.md).

---

## 1. Arquivos

```
src/features/denuncia/
  denuncia.routes.js              mapa da feature
  denuncia.controller.js          só HTTP
  denuncia.validators.js          esquemas de entrada
  denuncia.mapper.js              model → JSON (lista branca)
  denuncia.constants.js           motivos, desfechos, providências
  denuncia.alvo.service.js        o alvo existe? de quem é?
  denuncia.criacao.service.js     abertura, idempotência, evento em tempo real
  denuncia.consulta.service.js    fila priorizada, agrupamento, minhas
  denuncia.resolucao.service.js   julgamento e aviso ao denunciante
```

`denuncia.alvo.service.js` é o único arquivo que conhece as outras tabelas. A
denúncia é genérica por decisão de modelagem (uma tabela para os quatro alvos,
ver `models/denuncia.js`); sem esse arquivo, a genericidade viraria o mesmo
`switch` repetido na criação e na resolução.

---

## 2. Endpoints

| Método | Rota | Permissão | Observação |
|---|---|---|---|
| POST | `/v1/denuncias` | `denuncia.criar` | qualquer conta logada |
| GET | `/v1/denuncias` | `denuncia.ler` **escopo `todas`** | fila priorizada |
| GET | `/v1/denuncias/agrupadas` | `denuncia.ler` **escopo `todas`** | `GROUP BY` por alvo |
| GET | `/v1/denuncias/minhas` | autenticado | acompanhamento do denunciante |
| GET | `/v1/denuncias/:id` | `denuncia.ler` (própria ou todas) | 404 quando não é sua |
| PATCH | `/v1/denuncias/:id/resolver` | `denuncia.resolver` | motivo obrigatório |

Escrita com `rateLimit.escrita()` (30/min).

---

## 3. Decisões que valem explicação

### 3.1 O denunciante não é exposto ao denunciado — nunca

Esta é a decisão mais importante do módulo e foi tomada assim:

* o mapper **padrão não emite `denuncianteId`** em lugar nenhum — nem no recibo
  de quem denunciou, nem na linha da fila, nem no evento de tempo real;
* a identidade só sai em `GET /denuncias/:id`, para quem tem escopo `todas`
  **e** `lgpd.acessar_dado_pessoal` — e a abertura da ficha grava
  `logs_acesso_dado`;
* o campo `denunciante_id` **é gravado** (denúncia anônima de verdade
  inviabilizaria responder ao denunciante e abriria a porta para spam), mas
  vive só no banco.

O motivo é de produto: o mercado de peças agrícolas em MT é pequeno e as
pessoas se conhecem. Se denunciar significar virar alvo de retaliação
comercial, ninguém denuncia — e a moderação fica cega.

### 3.2 Idempotência por alvo

A mesma pessoa denunciando o mesmo alvo duas vezes recebe **200 com a denúncia
original**, não 201 e não 409. Não é higiene de dados: a fila é ordenada por
quantidade de denúncias no alvo, então permitir repetição daria a qualquer um o
poder de empurrar um concorrente para o topo da fila clicando várias vezes.

O 409 foi descartado porque, para quem clicou duas vezes, deu no mesmo — e um
erro só ensinaria o front a tratar uma duplicidade que não é problema.

### 3.3 Auto-denúncia bloqueada (403 `AUTO_DENUNCIA`)

Não existe caso legítimo. O ilegítimo existe: inflar o próprio contador para
depois alegar perseguição, ou apenas poluir a fila.

### 3.4 Prioridade calculada no banco

A ordenação usa uma **subconsulta correlacionada** que conta denúncias abertas
sobre o mesmo `(alvo_tipo, alvo_id)`. Cinco pessoas denunciando o mesmo anúncio
é caso mais urgente que cinco anúncios com uma denúncia cada. Empate desempata
pela mais antiga, para que nada envelheça no fim da fila para sempre.

O agrupamento (`/agrupadas`) é `GROUP BY` em SQL cru — é relatório, não
conjunto de models, e agregar pelo ORM devolveria instâncias falsas.

### 3.5 Resolução em lote

Resolver uma denúncia resolve, por padrão, **todas as abertas sobre o mesmo
alvo**. Dez pessoas denunciaram o mesmo anúncio: a decisão vale para as dez, e
todas recebem a notificação. Fechar uma a uma faria o moderador repetir o mesmo
texto dez vezes e deixaria nove denunciantes sem resposta.

### 3.6 Ninguém se auto-inocenta

Um moderador não julga denúncia que **ele abriu** nem denúncia **contra ele**
(403 `CONFLITO_DE_INTERESSE`). A permissão `denuncia.resolver.todas` sozinha não
distingue esse caso — a distinção é feita no service.

### 3.7 Resolver não pune

`PATCH /:id/resolver` só registra o veredito. A punição (ocultar anúncio,
suspender conta) é ação da feature `moderacao`, com permissão e auditoria
próprias. Separar é o que impede que "arquivar uma denúncia" vire um atalho
para banir alguém sem passar por `usuario.banir`.

---

## 4. Tempo real

Ao criar: `DENUNCIA_NOVA` para a sala `moderacao`, **depois** de gravar. O
evento leva alvo, motivo e a contagem no alvo — nunca o denunciante.

Ao resolver: `MODERACAO_PENDENTE` para a mesma sala, para o contador do painel
cair sozinho.

---

## 5. Pendências conhecidas

1. **`src/routes/index.js` precisa registrar o router** — o arquivo é proibido
   a este módulo. Falta a linha
   `router.use('/v1/denuncias', require('../features/denuncia/denuncia.routes'));`
2. **`DENUNCIA_ALVO` não tem `usuario`.** O enum da migration é
   `['anuncio', 'perfil', 'mensagem', 'conversa']`. Denunciar uma pessoa se faz
   pelo **perfil** dela, que resolve para o mesmo `denunciado_id`. Se a cliente
   quiser o alvo `usuario` explícito, é migration.
3. **`notificacao.criar` ainda não existe** como trabalho de fila. O contrato
   combinado já é usado; hoje `filas.enfileirar` só registra
   `[filas] trabalho desconhecido` e segue. Passa a funcionar sozinho quando o
   módulo `notificacao` registrar o job.
4. Não há índice em `denuncias (denunciante_id, alvo_tipo, alvo_id)` — a
   consulta de idempotência hoje se apoia no índice `(alvo_tipo, alvo_id)`.
   Vale medir quando a tabela crescer.
