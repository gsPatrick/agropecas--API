# Feature `auth`

Cadastro, login, sessão, senha, confirmação de e-mail e consentimento LGPD.

```
src/features/auth/
  auth.routes.js                mapa da feature: rota, limite, validação, permissão
  auth.controller.js            só HTTP — lê req, chama service, devolve
  auth.validators.js            esquemas de entrada (dado, não código)
  auth.mapper.js                model → JSON, lista branca
  auth.constants.js             vocabulários fechados (motivos, consentimentos)

  auth.registro.service.js      criar conta + perfil + papel, em uma transação
  auth.login.service.js         autenticar por e-mail e senha
  auth.sessao.service.js        abrir, renovar, encerrar, listar sessões
  auth.senha.service.js         recuperar e trocar senha
  auth.verificacao.service.js   confirmar e-mail
  auth.token.service.js         códigos de uso único (OTP)
  auth.tentativa.service.js     bloqueio por tentativas
  auth.consentimento.service.js registro de aceite (LGPD)
```

**Um assunto por arquivo.** Não existe `auth.service.js`: o arquivo único que
começa com login e termina com LGPD é exatamente o que ninguém consegue mais
mexer seis meses depois.

---

## 1. Endpoints

Base: `/api/v1/auth`

### Público

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/registrar` | Cria conta + perfil + papel `usuario`, devolve tokens |
| `POST` | `/entrar` | Login por e-mail e senha |
| `POST` | `/renovar` | Troca o refresh por um par novo (rotação) |
| `POST` | `/senha/solicitar` | Envia código de recuperação |
| `POST` | `/senha/conferir` | Valida o código **sem consumir** |
| `POST` | `/senha/redefinir` | Consome o código e grava a nova senha |
| `POST` | `/email/confirmar` | Confirma o e-mail e ativa a conta |
| `POST` | `/email/reenviar` | Reenvia o código de confirmação |

### Autenticado

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/eu` | Usuário, perfil, papéis e permissões da sessão atual |
| `POST` | `/sair` | Encerra a sessão atual |
| `POST` | `/sair-de-todos` | Encerra as demais (ou todas, com `manterAtual: false`) |
| `PATCH` | `/senha` | Troca a senha informando a atual |
| `GET` | `/sessoes` | Aparelhos conectados |
| `DELETE` | `/sessoes/:id` | Encerra uma sessão — própria, ou qualquer uma se Admin |
| `GET` | `/consentimentos` | Histórico de aceites |
| `PATCH` | `/consentimentos` | Aceita ou revoga um consentimento |

---

## 2. As decisões que valem explicação

### Access curto + refresh no banco

JWT **não é revogável**. Por isso o access token dura 15 minutos e é o refresh
— opaco, guardado como hash em `sessoes` — que carrega o poder de encerrar.
"Sair de todos os aparelhos" só é real por causa disso.

O access token também carrega `sid` (id da sessão), e `autenticar` confere se
a sessão ainda vive. Sem isso, revogar deixaria o token valendo até expirar.

### Rotação a cada renovação

Cada `/renovar` invalida o refresh usado. Reuso de token roubado passa a ser
detectável em vez de silencioso.

### Permissão vem do banco, nunca do token

O payload do JWT tem `sub`, `email` e `sid`. **Nada de papéis.** Se a Admin
revogar um acesso, precisa valer no próximo request — não no próximo login.
Isso custa uma consulta por requisição e paga o custo na primeira vez que
alguém for banido.

### A falha de login é sempre a mesma

Conta inexistente e senha errada devolvem `401 CREDENCIAL_INVALIDA`, iguais.
Distinguir as duas transforma o endpoint em consulta de base de clientes — num
mercado pequeno, isso é informação comercial de graça.

O mesmo vale para `/senha/solicitar` e `/email/reenviar`: resposta idêntica com
ou sem cadastro.

Exceção deliberada: conta **suspensa ou banida** responde `423` com motivo. Aí
o usuário precisa saber com quem falar.

### Duas camadas contra força bruta

| Camada | Onde | Alvo | Por quê |
|---|---|---|---|
| Rate limit | `middlewares/rate-limit.js` | IP + rota | Barra script antes de tocar o banco |
| Bloqueio de conta | `auth.tentativa.service.js` | Conta | Protege o alvo, não a rede |

O rate limit conta pelo `cache`: com Redis, o limite vale para **todas as
instâncias juntas**. Antes contava num `Map` local, e duas instâncias atrás de
um balanceador transformavam o limite de 10 em 20.

O bloqueio é por conta e **não por IP**: no interior de MT é comum a região
inteira sair pelo mesmo IP de operadora. Bloquear IP tiraria clientes
legítimos do ar; bloquear a conta afeta só quem está sob ataque, e o dono
recupera pelo fluxo de senha.

### Trocar senha derruba as sessões

É o gesto de quem desconfia de invasão. Manter o invasor logado esvaziaria o
remédio. A sessão que fez a troca sobrevive — expulsar quem trocou da própria
tela seria só atrito.

### E-mail não segura a resposta

Confirmação, recuperação e aviso de senha alterada vão para a fila `email`. O
cadastro não pode ficar refém do tempo de resposta de um provedor externo, e a
retentativa com espera exponencial é da fila, não do service.

### Cadastro é uma transação só

Usuário, Perfil e papel `usuario` nascem juntos ou não nascem. Conta sem perfil
não anuncia e não aparece na plataforma — seria um cadastro que parece ter dado
certo e não serve para nada.

Fora da transação ficam e-mail e auditoria: provedor lento não pode segurar
nem desfazer um cadastro válido.

### Conta nasce `pendente`

Confirmar o e-mail é o que ativa. Se o produto decidir não exigir isso,
`AUTH_EXIGIR_EMAIL_VERIFICADO=false` deixa a conta usar tudo mesmo pendente —
a rigidez fica na configuração, não no código.

---

## 3. LGPD nesta feature

| Prática | Onde |
|---|---|
| IP nunca em claro no banco — só `sha256(ip + sal)` | `utils/hash.js`, `middlewares/contexto.js` |
| Código de OTP guardado em hash | `auth.token.service.js` |
| Consentimento é **histórico imutável**: revogar cria linha, não apaga | `auth.consentimento.service.js` |
| Base legal registrada por aceite (`execucao_contrato` × `consentimento`) | idem |
| Versão do documento aceita fica gravada | idem |
| `origem` diz onde o aceite foi colhido (cadastro, perfil, admin) | idem |
| Toda ação sensível grava em `logs_auditoria` | `features/auditoria/auditoria.service.js` |

Obrigatórios no cadastro: `termos_de_uso` e `politica_privacidade`. Sem os dois,
`422` — o registro nem começa.

---

## 4. Escopo e Admin

O middleware `autorizar` cobre a **capacidade**. O **escopo** (próprio × todos)
depende do dono do registro, que só é conhecido depois da consulta — por isso
mora no controller/service:

```js
const alvo = await db.Sessao.findByPk(req.params.id);
exigir(req.contexto, 'usuario.encerrar_sessoes', { donoId: alvo.usuario_id });
```

Usuário comum encerra as próprias sessões; Admin encerra a de qualquer um, pelo
coringa `*`. Ver [RBAC.md](../RBAC.md).

---

## 5. Formato das respostas

```jsonc
// sucesso
{ "sucesso": true, "dados": { … }, "meta": { … } }

// erro
{
  "sucesso": false,
  "erro": { "codigo": "CREDENCIAL_INVALIDA", "mensagem": "…", "detalhe": { … } },
  "requisicaoId": "uuid"
}
```

`codigo` é string estável — o front decide o que mostrar sem depender do texto,
que muda. `requisicaoId` volta também no header `X-Request-Id`, para o suporte
cruzar reclamação e log.

Códigos usados aqui: `CREDENCIAL_INVALIDA`, `CONTA_BLOQUEADA`, `TOKEN_AUSENTE`,
`TOKEN_EXPIRADO`, `TOKEN_INVALIDO`, `SESSAO_REVOGADA`, `REFRESH_INVALIDO`,
`SESSAO_INVALIDA`, `SESSAO_EXPIRADA`, `CODIGO_INVALIDO`, `EMAIL_NAO_VERIFICADO`,
`VALIDACAO`, `CONFLITO`, `MUITAS_TENTATIVAS`, `SEM_PERMISSAO`.

---

## 6. Auditoria de segurança

32 vetores de ataque executados contra a API rodando — não leitura de código.
**31 bloqueados.** Repetível a qualquer momento:

```bash
npm run test:seguranca
```

### O que foi testado e resiste

| Ataque | Resultado |
|---|---|
| Token assinado com outro segredo | 401 |
| `alg:none` (confusão de algoritmo) | 401 |
| Token sem `issuer`/`audience` corretos | 401 |
| Token expirado | 401 |
| Token válido **sem** `sid` (sessão) | 401 |
| `sub` de uma pessoa + `sid` de outra | 401 |
| Access token depois do logout | 401 |
| Refresh depois do logout | 401 |
| Reuso de refresh já rotacionado | 401 **+ sessão derrubada** |
| Encerrar sessão de terceiro | 403 |
| `usuario_id` injetado no corpo (mass assignment) | ignorado |
| `papeis: ['admin']` no cadastro | ignorado |
| `status: 'ativo'` / `verificado` forçados no cadastro | ignorados |
| `senha_hash`, `ip_hash`, `observacoes_internas` na resposta | ausentes |
| Token de conta banida / removida | 423 / 401 |
| Enumeração por mensagem de erro | mensagens idênticas |
| Enumeração por tempo de resposta | equalizado |
| Operador de consulta (`{"$ne":null}`) no e-mail | 4xx |
| SQL injection no login | 4xx |
| Segredo padrão de desenvolvimento em produção | aplicação recusa subir |

### Correções que a auditoria motivou

**1. Token exige sessão, e a sessão precisa ser da pessoa certa.**
Antes, `sid` era opcional e a sessão não era conferida contra o `sub`. Um token
sem `sid` criava um acesso que **nenhum logout alcançava** — não havia o que
revogar. Hoje: sem `sid` é 401, e `sessao.usuario_id !== usuario.id` é 401.

**2. Reuso de refresh derruba a sessão inteira.**
Recusar só a requisição era insuficiente: com duas cópias do token circulando,
quem roubou continuava renovando com a cópia boa. Como a rotação é a cada uso,
**ninguém legítimo reapresenta o token anterior** — então isso é assinatura de
roubo, e a sessão cai. Colunas `token_anterior_hash` e
`reutilizacao_detectada_em` (migration `20260811000000`).

**3. Enumeração por tempo.**
Conta inexistente respondia em ~3ms contra ~120ms de uma real, porque não havia
bcrypt para rodar. O cronômetro entregava a lista de cadastrados mesmo com a
mensagem idêntica. Hoje `senhaProvider.conferirFalso()` gasta o mesmo tempo.

**4. Segredo de desenvolvimento em produção.**
`JWT_SECRET` e `SECURITY_IP_SALT` caíam no valor de exemplo em qualquer
ambiente. Tudo funcionaria, e quem lesse o repositório assinaria um token de
Admin. Hoje, `NODE_ENV=production` sem essas variáveis **impede a aplicação de
subir**.

**5. Negação de permissão virava 500.**
`exigir()` do RBAC lançava `Error` cru, que o middleware não reconhecia. Um 403
legítimo aparecia como falha do servidor. Hoje lança `AppError`.

### O vetor que segue aberto — por decisão, não por descuido

**O cadastro confirma que um e-mail existe** (`409` em e-mail já usado). Isso é
enumeração de contas.

A alternativa seria responder sempre "verifique seu e-mail" e não dizer nada —
o que, para o público desta plataforma, significa produtor rural preenchendo o
cadastro de novo sem entender por que não entrou. Optei pelo `409` claro, com
duas contenções: o endpoint tem limite de 10 requisições por 15 minutos por IP,
e o dado exposto é apenas "este e-mail tem conta", não perfil nem telefone.

Se a preferência for o inverso, a mudança é pequena e está isolada em
`auth.registro.service.js`.

---

## 7. Pendências conhecidas

- **Provider de e-mail é stub.** `providers/email/` registra no console em
  desenvolvimento. Integrar SMTP/Resend/SES é reescrever só a função `enviar` —
  o envio já passa pela fila `email`, então retentativa e espera já existem.
- **OTP por SMS/WhatsApp** não existe: `TOKEN_TIPO` já prevê
  `verificacao_telefone`, mas não há provider.
- **Login social** não foi pedido; se entrar, vira `auth/oauth/` sem tocar no
  restante.
- **Sessão não é vinculada a IP nem a aparelho.** Vincular quebraria usuário em
  rede móvel do campo, que troca de IP o tempo todo. A contenção escolhida foi
  access token curto + rotação com detecção de reuso.
- **Sem `helmet`.** A API não serve HTML, então o ganho é pequeno, mas vale
  incluir junto do deploy.
