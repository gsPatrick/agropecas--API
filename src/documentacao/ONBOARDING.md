# Onboarding

## 1. Requisitos

- Node 20+
- PostgreSQL 14+ (as extensões `pg_trgm` e `unaccent` são usadas na busca)

## 2. Subir

```bash
cp .env.example .env      # ajuste DB_USER, DB_PASSWORD e DB_NAME
npm install
createdb agropecas        # ou crie pelo seu cliente de Postgres
npm run migrate
npm run dev               # http://localhost:3333/api/health
```

## 3. Conferir

```bash
curl http://localhost:3333/api/health
# { "status": "ok", "banco": "ok", ... }

npm run models:check
# lista os 47 models, campos e relações — roda sem banco
```

## 4. Ordem sugerida de construção

Cada módulo entrega: migration + feature (`routes/controller/service`) + doc em
`documentacao/features/`.

1. **auth** — cadastro, login, refresh, recuperação de senha, OTP
2. **usuario / perfil** — dados do titular, consentimentos, upload de foto
3. **catalogo** — categorias, marcas, máquinas, serviços (CRUD do Admin)
4. **anuncio** — publicação, fotos, moderação, expiração
5. **busca** — filtros, ordenação, paginação, log de busca
6. **conversa** — chat, participantes, não lidas, notificação
7. **admin** — moderação, denúncias, intervenção, auditoria
8. **lgpd** — solicitações do titular, exportação, anonimização

## 5. Logs

Ainda não há logger estruturado — `console` até a feature de observabilidade.
Ao criar: `src/providers/logger/`, nunca `console.log` espalhado em service.

## 6. Primeiro usuário admin

Será criado por seeder na feature **auth** (`seeders/`), lendo e-mail e senha
de variável de ambiente. Não commitar credencial.
