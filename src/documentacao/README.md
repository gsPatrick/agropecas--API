# API AgroPeças MT — documentação

Comece aqui.

| Documento | Para quê |
|---|---|
| [ONBOARDING.md](ONBOARDING.md) | Subir o projeto do zero na sua máquina |
| [ENV_REFERENCE.md](ENV_REFERENCE.md) | O que cada variável de ambiente faz |
| [models/README.md](models/README.md) | Mapa do banco: as 49 tabelas e por que existem |
| [RBAC.md](RBAC.md) | Papéis, permissões, escopo e o poder total do Admin |
| [INFRAESTRUTURA.md](INFRAESTRUTURA.md) | Validação, cache, filas e cabeçalhos de segurança |
| [PADRAO_MODULO.md](PADRAO_MODULO.md) | O contrato que todo módulo segue |
| [features/Admin.md](features/Admin.md) | Painel administrativo: por que a estrutura é diferente |
| [models/LGPD.md](models/LGPD.md) | Dado pessoal, base legal, retenção e o que nunca se apaga |
| `features/` | Uma página por feature, criada junto com a feature |

## Onde as coisas vivem

```
app.js                 entrada: Express, montagem de rotas, erro global
src/config/            tudo que vem do ambiente, num lugar só
src/models/            uma entidade por arquivo + index.js (associações)
src/rbac/              módulo de base: recursos, permissões, papéis, motor
src/validacao/         módulo de base: vocabulário de entrada + adaptador
src/cache/             módulo de base: cache com adaptador Redis/memória
src/filas/             módulo de base: jobs com adaptador BullMQ/imediato
src/features/<nome>/   routes → controller → services, tudo plano na pasta
src/middlewares/       contexto, autenticar, autorizar, validar, rate limit, erro
src/utils/             funções puras: erros, texto, documento, hash, validação
src/providers/         clientes de sistemas externos: ViaCEP, e-mail, storage
migrations/            schema versionado, criado módulo a módulo
testes/                suítes que rodam contra a API e o banco de verdade
worker.js              processo separado que consome as filas
```

## Testes

Rodam contra a API e o banco de verdade — o que interessa é o comportamento
observável pela rede, que é o que o front e um atacante veem.

```bash
npm test                # as 22 suítes, em sequência
npm run test:auth       # fluxo completo: cadastro, login, sessão, senha, LGPD
npm run test:rbac       # escopo de permissão, poder do Admin, conta suspensa
npm run test:seguranca  # auditoria do auth: 32 vetores de ataque
npm run test:sistema    # auditoria do sistema inteiro: 69 vetores
npm run test:admin      # as 8 suítes do painel, incluindo a de segurança
npm run test:anuncio    # …e uma por módulo
```

Precisam de banco migrado e semeado (`npm run setup`).

## Regras que não se quebram

1. **Fluxo `routes → controller → service`.** Controller só fala HTTP; regra de negócio vive no service.
2. **Integração externa nunca no controller** — vai para `providers/`.
3. **`routes/index.js` é o único agregador** de rotas da versão atual.
4. **Variável nova = atualizar `.env.example` E `ENV_REFERENCE.md`** no mesmo commit.
5. **Mudou model, criou migration.** Alterar só a definição deixa o banco mentindo.
6. **Um service por assunto.** `auth.login.service.js`, `auth.senha.service.js` — nunca um `auth.service.js` com vinte funções.
7. **Nada de instância do Sequelize na resposta.** Passa pelo mapper da feature, que é lista branca.
8. **Biblioteca externa fica atrás de adaptador.** `zod`, `ioredis` e `bullmq` só existem dentro de `src/validacao/adaptadores`, `src/cache/adaptadores` e `src/filas/adaptadores`. `npm run validacao:check` reprova quem furar.
9. **Nada que demore fica no caminho da resposta.** E-mail, imagem e relatório vão para `src/filas/`.

## Estado atual

✅ Estrutura, config, conexão, agregador de rotas, health check
✅ **49 models completos** com associações — `npm run models:check` valida
✅ **Schema completo** em migration — `npm run migrate`
✅ **RBAC completo**: 21 recursos, 117 permissões, 4 papéis — `npm run rbac:check`
✅ **Utils e middlewares** — contexto, autenticação, autorização, validação, rate limit, erro
✅ **Feature `auth` completa** — [features/Auth.md](features/Auth.md)
✅ **Auditoria de segurança do auth**: 32 vetores testados contra a API rodando, 31 bloqueados
✅ **Infraestrutura**: helmet, validação com adaptador, cache (Redis/memória), filas (BullMQ/imediato), worker separado, tempo real (Socket.IO com pub/sub Redis)
✅ **18 módulos** — 281 endpoints. Um `.md` por módulo em `features/`
✅ **Painel administrativo** (`src/features/admin/`) — estrutura própria: `admin.routes.js` + `controllers/` + `services/` + `helpers/`. Composição das features, sem duplicar regra
✅ **1.365 verificações** em 30 suítes contra API, Postgres, Redis e Socket.IO reais
✅ **Auditorias de segurança**: 32 vetores no auth · 69 no sistema · 30 no painel
⬜ Demais features — uma por vez: usuario, perfil, localizacao, catalogo, midia, anuncio, busca…
