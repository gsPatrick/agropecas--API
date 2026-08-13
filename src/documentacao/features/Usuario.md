# Usuário — gestão da conta

O que sobra depois que o `auth` cuidou de entrar e sair: ver e editar os
próprios dados, trocar o e-mail, moderar contas alheias, mexer em papéis e
sair da plataforma.

**Não está aqui, e não deve entrar:** sessão, senha, consentimento e
confirmação de e-mail do cadastro — tudo isso é do módulo `auth`. Este módulo
o consome (`auth.token.service`, `auth.sessao.service`), nunca o duplica.

---

## 1. Estrutura

```
src/features/usuario/
  usuario.routes.js              mapa da feature
  usuario.controller.js          só HTTP
  usuario.validators.js          esquemas de entrada
  usuario.mapper.js              model → JSON (três recortes: eu, item, ficha)
  usuario.constants.js           colunas, motivos de revogação, vocabulários
  usuario.consulta.service.js    listagem com escopo + ficha individual
  usuario.perfil.service.js      edição de dados cadastrais
  usuario.email.service.js       troca de e-mail com reconfirmação
  usuario.moderacao.service.js   suspender · banir · restaurar
  usuario.papel.service.js       atribuir e remover papel (RBAC)
  usuario.exclusao.service.js    exclusão = anonimização (LGPD)
  usuario.acesso.service.js      registro de leitura de dado pessoal (LGPD)
```

---

## 2. Endpoints

Prefixo: `/api/v1/usuarios`. **Todas** exigem autenticação.

| Método | Rota | Permissão | Observação |
|---|---|---|---|
| GET | `/eu` | autenticado | a própria conta, com papéis |
| PATCH | `/eu` | `usuario.editar.proprio` | nome, telefone, whatsapp, idioma, fuso |
| POST | `/eu/email` | autenticado + senha atual | pede a troca; código vai para o endereço NOVO |
| POST | `/eu/email/confirmar` | autenticado | aplica a troca |
| DELETE | `/eu` | `usuario.remover.proprio` + senha | anonimiza (não apaga) |
| GET | `/` | `usuario.ler.todos` | paginado, busca por nome/e-mail, filtro de status e papel |
| GET | `/:id` | `usuario.ler` (escopo) | ficha; leitura de terceiro grava em `logs_acesso_dado` |
| PATCH | `/:id` | `usuario.editar` (escopo) | edição administrativa |
| DELETE | `/:id` | `usuario.remover.todos` | exclusão administrativa |
| POST | `/:id/suspender` | `usuario.suspender` | motivo **e** prazo obrigatórios; derruba sessões |
| POST | `/:id/banir` | `usuario.banir` | motivo obrigatório; derruba sessões |
| POST | `/:id/restaurar` | `usuario.restaurar` | volta para `ativo` ou `pendente` |
| GET | `/:id/papeis` | `usuario.ler` (escopo) | |
| POST | `/:id/papeis` | `rbac.atribuir_papel` | |
| DELETE | `/:id/papeis/:papel` | `rbac.atribuir_papel` | |

Nenhuma ação nova de RBAC foi criada — o catálogo de `recursos.js` já cobria
tudo o que o módulo faz.

---

## 3. Decisões que valem explicação

**A listagem exige `.todos`, não `.proprio`.** `filtroDeEscopo` devolveria
`{ id: <eu> }` para o usuário comum, e a rota responderia 200 com uma lista de
um item — uma tela inútil que ainda sugere que a listagem "quase funciona".
Para ver a si mesmo existe `GET /eu`; a listagem é ferramenta de moderação e
responde 403 para quem não é moderação.

**Leitura responde 404, escrita responde 403 — e nenhuma das duas vaza
existência.** Em `GET /:id`, "existe mas não é seu" e "não existe" devolvem o
mesmo 404: senão bastaria varrer UUIDs e anotar quais dão 403 para mapear a
base. Em `PATCH /:id`, a capacidade é conferida **antes** de qualquer consulta,
então o 403 sai igual para id existente e inexistente — mesma proteção, com a
mensagem que o front espera numa tela de edição.

**O e-mail novo viaja no token, não no usuário.** `POST /eu/email` não escreve
nada em `usuarios`: o endereço fica no `destino` do `TokenVerificacao` (tipo
`verificacao_email`, mecanismo do `auth`) e só substitui o antigo na
confirmação. Gravar antes entregaria a conta a quem digitou errado — perde a
recuperação — ou a quem sequestrou uma sessão. Pelo mesmo motivo a troca pede
a **senha atual** e o endereço **antigo recebe aviso**: é assim que o dono
descobre um sequestro.

**Suspender/banir sem derrubar sessão não suspende ninguém.** O access token
vale ~15 minutos e não é revogável; sem `encerrarTodas` o suspenso seguiria
usando a plataforma e renovando pelo refresh. As sessões caem e o evento
`SESSAO_ENCERRADA` avisa as abas abertas — evento é entrega complementar, o
registro do fato é o banco.

**Motivo obrigatório em toda mudança de status.** Prestação de contas da LGPD e
sanidade operacional: suspensão sem motivo registrado é a que ninguém consegue
explicar quando o usuário reclama.

**Exclusão anonimiza na hora e agenda o descarte.** `LGPD.md` §2: apagar a
linha levaria junto anúncios e conversas da outra parte. Então nome, e-mail,
telefone, WhatsApp, `senha_hash` e `observacoes_internas` são substituídos
**imediatamente** — o direito do titular é imediato, e "anonimização agendada"
deixaria o dado pessoal vivo até o job rodar —, `anonimizado_em` marca o
evento, `excluir_definitivamente_em` recebe hoje + `LGPD_RETENCAO_DIAS` (180) e
o soft delete (`removido_em`) tira a conta das consultas normais. A trilha de
auditoria registra o status, **não** o nome e o e-mail: gravar o dado pessoal
no log desfaria a anonimização que acabou de acontecer.

**Três travas contra escalada de privilégio**, todas no servidor: papel só com
`rbac.atribuir_papel`; ninguém altera os próprios papéis (senão uma conta de
moderador comprometida vira admin sozinha e a auditoria acusa a vítima);
ninguém se bane ou se suspende. A exclusão da última conta com papel `admin`
também é recusada — a plataforma não pode ficar sem quem conceda o papel de
volta.

**`motivo_status` aparece na ficha de moderação, não em `GET /eu`.** É anotação
de quem moderou; expor a redação interna ao suspenso transforma cada suspensão
em discussão sobre a frase.

**Sem cache.** A listagem é tela de moderação, onde ver estado velho de uma
conta que acabou de ser banida é pior do que a consulta extra. Se o volume
crescer, o candidato é a ficha individual (`GET /:id`), não a listagem — e a
chave nasceria em `usuario.cache.js`, como manda o padrão.

---

## 4. Performance

- Paginação com teto de `utils/paginacao` (`porPagina` sem `max` no validador:
  o pedido acima do teto é *clampado*, não recusado).
- `attributes` explícito em listagem e ficha (`CAMPOS_LISTA` / `CAMPOS_DETALHE`)
  — `observacoes_internas` e `senha_hash` nem saem do banco.
- Papéis por `include` com `through: { attributes: [] }` e
  `distinct: true` na contagem — sem N+1 e sem contagem inflada pelo JOIN N:N.
- `logs_acesso_dado` da listagem grava em `bulkCreate`, não uma linha por vez.
- Escrita em duas tabelas (consumir token + trocar e-mail; anonimizar + soft
  delete) roda em transação.

---

## 5. Pendências

1. **Rota não registrada.** `src/routes/index.js` é do orquestrador e este
   módulo não pode editá-lo. Falta descomentar
   `router.use('/v1/usuarios', require('../features/usuario/usuario.routes'))`.
   Enquanto isso, `testes/usuario.test.js` monta o router no mesmo `Router` do
   app antes de carregá-lo.
2. **Descarte após a retenção.** Nada varre `excluir_definitivamente_em` hoje.
   O lugar natural é `src/filas/trabalhos/manutencao.trabalho.js`, com um job
   diário — precisa de decisão de quem mantém aquele arquivo.
3. **Perfil não é anonimizado junto.** `perfis` guarda documento (CPF/CNPJ),
   razão social e bio, que são dado pessoal do mesmo titular. A anonimização
   completa depende do módulo de perfil; hoje a exclusão limpa só `usuarios`.
4. **Busca sem índice adequado.** `ILIKE '%termo%'` em `nome`/`email` não usa
   os índices existentes. Com base grande, pede `pg_trgm` — migration, portanto
   decisão do orquestrador.
5. **Reativação automática de suspensos.** `suspenso_ate` vence sozinho, mas
   nada devolve o status para `ativo`; hoje depende de `POST /:id/restaurar`.
6. **Registro do e-mail anterior.** A troca guarda o endereço antigo só na
   trilha de auditoria. Se o produto quiser histórico consultável de e-mails,
   isso é tabela nova.
