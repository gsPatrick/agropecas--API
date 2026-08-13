# Contato

Registra a **intenção de contato** entre interessado e anunciante, e revela o
WhatsApp do anunciante quando — e só quando — ele consentiu.

A plataforma não intermedeia a venda: o combinado sai no WhatsApp e a API nunca
vê o resto (`Maturacao/05`, §7). O que ela consegue registrar é o momento em que
alguém decidiu falar com o anunciante — e é exatamente esse número que responde
à única pergunta que a cliente faz sobre o próprio anúncio:
**"quantas pessoas me chamaram?"**.

Este é o módulo mais sensível construído até aqui. Ele devolve telefone de
terceiro.

---

## 1. Arquivos

```
src/features/contato/
  contato.routes.js                mapa da feature
  contato.controller.js            só HTTP
  contato.validators.js            esquemas de entrada
  contato.mapper.js                model → JSON (lista branca)
  contato.constants.js             canais, janelas e cotas
  contato.cache.js                 chaves das janelas (contador e cota)
  contato.limite.service.js        janela anti-refresh + cota anti-raspagem
  contato.registro.service.js      grava o contato, conta e notifica
  contato.revelacao.service.js     revela o WhatsApp (consentimento + LGPD)
  contato.consulta.service.js      "quem me chamou"
  contato.metrica.service.js       leitura agregada e a agregação em si

src/filas/trabalhos/contato.trabalho.js
  contato.agregarMetricas · contato.fecharDia
```

| Service | Assunto |
|---|---|
| `limite` | contagem com janela. As duas defesas do módulo num arquivo só. |
| `registro` | grava `anuncio_contatos`, incrementa os contadores do anúncio, enfileira notificação e agregação. |
| `revelacao` | o endpoint sensível: cota → consentimento → rastro → número. |
| `consulta` | listas nominais de contatos recebidos (cai sob LGPD). |
| `metrica` | série diária agregada e os jobs que a mantêm. |

---

## 2. Endpoints

Prefixo sugerido: `/api/v1/contatos`.

| Método | Rota | Login | Permissão | O que faz |
|---|---|:---:|---|---|
| `POST` | `/anuncios/:anuncioId` | opcional | — | Registra a intenção (`canal`, `origem`). |
| `POST` | `/anuncios/:anuncioId/revelar` | **exigido** | — | Devolve o WhatsApp do anunciante e registra o acesso. |
| `GET` | `/recebidos` | exigido | `anuncio.ver_contatos` | Contatos em todos os meus anúncios. |
| `GET` | `/anuncios/:anuncioId/recebidos` | exigido | `anuncio.ver_contatos` (escopo do dono) | Quem chamou neste anúncio. |
| `GET` | `/anuncios/:anuncioId/metricas` | exigido | `anuncio.ver_metricas` (escopo do dono) | Série diária + totais do período. |

---

## 3. Por que revelar contato exige conta

**Decisão: exige.** É a decisão mais discutível do módulo, então vai inteira.

O documento da cliente diz que o contato é direto e preferencialmente por
WhatsApp (`Maturacao/05`, §7, item 5), e a §8.2.2 chega a afirmar que *"o
WhatsApp continua disponível sem login, porque ele não depende de conta
nenhuma"*. Lida ao pé da letra, essa frase pediria um endpoint anônimo
devolvendo telefone.

O que ela descreve, porém, é o **botão** — o link `wa.me` que o navegador abre.
Um endpoint de API que devolve o telefone de qualquer anunciante a qualquer
requisição sem sessão é outra coisa: é uma **API de exportação da base de
anunciantes de Mato Grosso**, entregue de graça a quem escrever vinte linhas de
script. E essa base — produtores, lojas e prestadores com telefone verificado e
segmentado por categoria e município — é o ativo que a plataforma existe para
construir. Perdê-la nas primeiras semanas mata o produto sem que ninguém
perceba, porque nada quebra.

Sem conta não há a quem aplicar cota (IP em MT sai muito por CGNAT de operadora:
bloquear IP tiraria a região inteira do ar), não há a quem responsabilizar e não
há a quem avisar quando um titular pedir a lista de quem acessou seu telefone —
que é um direito do art. 18 da LGPD, não uma cortesia.

**O que continua funcionando sem login:** navegar, buscar, abrir o anúncio e
registrar o clique (`POST /anuncios/:id`). O visitante que clica em "WhatsApp"
é levado ao login e volta para o anúncio — o mesmo fluxo que a §8.2.2 já define
para o chat interno. A fricção é de uma tela, e paga por si na primeira vez que
alguém tenta raspar.

> **Confirmar com a cliente.** Esta decisão contraria a leitura literal da
> §8.2.2 e está reportada ao orquestrador. Se ela insistir no acesso anônimo, o
> caminho menos ruim é liberar poucas revelações por `ip_hash` por dia com
> desafio (captcha) a partir da primeira — não abrir sem limite.

---

## 4. `exibir_whatsapp = false` significa que o número não sai

Não é preferência de UI. É consentimento LGPD (art. 8º), espelhado da tabela
`consentimentos` na coluna `perfis.exibir_whatsapp`, e o único lugar onde ele
pode ser verificado é o servidor: esconder o botão no front deixaria o número
na resposta da API para quem abrisse o DevTools.

Quando o consentimento não existe, o campo sai **nulo** — não vazio, não
mascarado. Mascarar (`(65) 9****-1234`) pareceria proteção e entregaria DDD,
operadora e os quatro dígitos finais, o bastante para cruzar com outra base.

A resposta devolve `exibirWhatsapp: false` e `aceitaChat`, para o front oferecer
o chat interno em vez de mostrar campo vazio — que é exatamente o motivo pelo
qual o chat existe (`Maturacao/05`, §8.1: *"nem todo anunciante quer expor o
número"*).

Nem o Admin fura isso. Se um dia houver necessidade legítima (ordem judicial,
apuração de fraude), o caminho é uma rota de moderação com log próprio e motivo
obrigatório — não afrouxar esta.

---

## 5. As duas janelas

Ambas em `contato.limite.service.js`, contadas por `cache.incrementar`, que é
atômico (`INCR`). Checar-e-depois-gravar abriria a janela clássica em que dez
requisições paralelas passam todas por estarem abaixo do limite ao mesmo tempo.

### 5.1 Janela anti-refresh do contador — 6 horas

Chave: `(anuncio × pessoa × canal)`. O mesmo interessado abrindo o anúncio três
vezes na mesma tarde é **um** interessado. Sem janela, o número que a cliente
usa para provar valor vira contagem de F5 — e uma métrica que qualquer um infla
sem querer não sustenta decisão nenhuma.

Seis horas cobre a sessão de pesquisa inteira de um comprador e ainda conta
separado quem voltou no dia seguinte para negociar, que é contato real. O canal
entra na chave porque clicar no WhatsApp e depois abrir o chat são duas
intenções distintas, e o anunciante quer ver as duas.

Repetição dentro da janela **não cria linha**. Guardar todas daria um
`anuncio_contatos` que o anunciante lê como "a mesma pessoa me chamou nove
vezes", o que não aconteceu.

O anunciante também não gera contato no próprio anúncio: clicar no botão para
conferir se funciona é o que todo anunciante faz no primeiro dia.

### 5.2 Cota de revelação — 30 por hora, **por pessoa**

Folgado para uso humano (quem compara peça olha uma dezena de anúncios) e
inviável para coleta em escala.

**Por que não usar `middlewares/rate-limit.js`:** ele monta a chave com
`método + caminho + cliente`, e o caminho desta feature carrega o id do anúncio.
O limite sairia **por anúncio** — e um raspador que percorre a listagem nunca
bateria em nenhum, porque nunca pede o mesmo anúncio duas vezes. Contra
raspagem, o limite tem de atravessar todos os anúncios.

O `rateLimit.escrita()` continua na rota como camada grossa contra flood na
mesma URL. `testes/contato.test.js` prova a diferença: esgota a cota num anúncio
e verifica que o **outro** anúncio também responde `429`.

Estar no service e não num middleware é decisão: a proteção vale para qualquer
chamador, inclusive um job futuro de exportação.

---

## 6. LGPD

Toda revelação de contato de terceiro grava em `logs_acesso_dado`
(`recurso: 'telefone'`, `recurso_id: anuncioId`), **inclusive quando o número
não saiu**. A tentativa faz parte da apuração de assédio, e um log que só
registra sucesso não mostra quem estava varrendo a base.

Ver o próprio contato não gera log: não há titular alheio.

Quando quem revela é Admin, além do log de acesso vai uma linha em
`logs_auditoria` — o rastro que `RBAC.md` §2 cobra do coringa.

IP sempre em hash (`utils/hash.js`), em `anuncio_contatos.ip_hash` e no log. O
IP em claro não passa de `middlewares/contexto.js`.

O mapper nunca expõe `ip_hash`, `user_agent` nem `sessao_hash`. Se um dia uma
tela de moderação precisar deles, o caminho é um mapper próprio para o Admin —
não afrouxar este.

**O anunciante não recebe o telefone de quem clicou.** Ele recebeu uma intenção
de contato, não um cadastro. Quem quiser falar de volta usa o chat interno, onde
a conversa fica registrada e moderável. Expor o telefone do interessado seria
inverter a regra de consentimento que este módulo inteiro existe para respeitar.

---

## 7. Contadores e agregação

| Onde | Como | Quando |
|---|---|---|
| `anuncios.total_contatos_whatsapp` / `_chat` | `increment` atômico, na transação do registro | no clique |
| `anuncio_metricas_diarias.cliques_whatsapp` / `conversas_iniciadas` | recalculado a partir de `anuncio_contatos` | job `contato.agregarMetricas` |
| `perfis.total_contatos` | `COUNT` e `update` | job `contato.fecharDia`, 1×/dia |

A agregação **reconta o dia inteiro** em vez de somar delta. Recontar é
idempotente; um job que soma delta duplica tudo na primeira retentativa — que o
BullMQ faz sozinho, sem avisar ninguém. Um `GROUP BY` só, nunca uma consulta por
anúncio.

`perfis.total_contatos` é recalculado e não incrementado porque é vitrine ("já
foi procurado 340 vezes"): um contador incremental que erra uma vez erra para
sempre. Só entram no recálculo os perfis com movimento nas últimas 24h — varrer
a base inteira todo dia seria pagar por milhares de perfis parados.

A leitura de métrica devolve `atualizadoEm` para a tela poder dizer "até ontem"
em vez de sugerir tempo real que não existe.

---

## 8. Notificação

Contrato fixo, combinado com o módulo `notificacao`:

```js
await filas.enfileirar('notificacao.criar', {
  usuarioId: donoDoAnuncio, tipo, titulo, mensagem, dados: { anuncioId },
  entidade: 'anuncios', entidadeId: anuncioId, canais: ['sistema'],
});
```

Só o canal `sistema`. E-mail a cada clique de WhatsApp transformaria a caixa de
entrada de uma loja ativa em spam; quem quiser resumo terá o digest do módulo de
notificação.

Falha ao enfileirar não derruba o registro: o contato já está no banco, que é o
fato. A notificação é entrega complementar (padrão §9).

---

## 9. Pendências conhecidas

1. **Registro do router.** Falta
   `router.use('/v1/contatos', require('../features/contato/contato.routes'))`
   em `src/routes/index.js` (arquivo proibido durante a construção paralela).
2. **Carregamento do job no worker.** `src/filas/index.js` só faz `require` dos
   trabalhos que existiam quando foi escrito. `contato.registro.service.js`
   importa `contato.trabalho.js` para resolver o processo web, mas o **worker**
   precisa da linha `require('./trabalhos/contato.trabalho')` em
   `src/filas/index.js`. Sem ela, `contato.agregarMetricas` some da fila real.
3. **`tipo` da notificação.** `NOTIFICACAO_TIPO` em `models/constantes.js` não
   tem um valor para contato recebido; o módulo usa `'sistema'`. O valor certo
   seria `contato_recebido`, e a mudança é no enum do banco — reportado.
4. **`contato.fecharDia` não está agendado.** O job existe e é idempotente;
   falta o agendamento periódico, que depende de Redis (`filas.agendar` recusa
   sem ele).
5. **Cota sem Redis vale por processo.** O cache cai para memória e a cota de
   revelação passa a ser por instância — inaceitável em produção com mais de uma
   réplica. É pendência de infraestrutura, não de código: `REDIS_URL` é
   obrigatório para este módulo cumprir o que promete.
6. **Canal `email` previsto e não usado.** O ENUM do banco aceita, mas nenhuma
   tela oferece e-mail como canal de contato hoje.
7. **`anuncio_contatos.sessao_hash` não é preenchido.** Serviria para
   correlacionar visitas do mesmo dispositivo antes do login; hoje a janela usa
   `ip_hash` para o visitante, que é mais grosseiro.
