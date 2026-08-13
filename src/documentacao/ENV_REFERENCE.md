# Variáveis de ambiente

Toda variável nova entra aqui **e** no `.env.example`, no mesmo commit.
Nenhum arquivo lê `process.env` direto: tudo passa por `src/config/index.js`.

## Aplicação

| Variável | Obrigatória | Padrão | O que faz |
|---|:---:|---|---|
| `NODE_ENV` | não | `development` | Em `production`, o erro 500 não devolve stack |
| `APP_PORT` | não | `3333` | Porta HTTP |
| `APP_API_PREFIX` | não | `/api` | Prefixo de todas as rotas |
| `APP_URL` | não | `http://localhost:3333` | URL pública da API (links em e-mail) |
| `APP_WEB_URL` | não | `http://localhost:3000` | URL do front (redirect pós-login, links de e-mail) |

## Banco

| Variável | Obrigatória | Padrão | O que faz |
|---|:---:|---|---|
| `DB_HOST` | sim | `localhost` | Host do Postgres |
| `DB_PORT` | não | `5432` | Porta |
| `DB_NAME` | sim | `agropecas` | Nome do banco |
| `DB_USER` | sim | `postgres` | Usuário |
| `DB_PASSWORD` | sim | — | Senha |
| `DB_SSL` | não | `false` | `true` em provedor gerenciado |
| `DB_LOGGING` | não | `false` | Loga SQL no console |
| `DB_POOL_MAX` / `DB_POOL_MIN` | não | `10` / `0` | Pool de conexões |

## Segurança

| Variável | Obrigatória | Padrão | O que faz |
|---|:---:|---|---|
| `SECURITY_IP_SALT` | **sim em produção** | — | Sal do hash de IP nos logs. **LGPD**: sem ele o IP fica identificável; trocar o sal invalida a correlação de logs antigos, o que é intencional |
| `JWT_SECRET` | **sim em produção** | — | Assinatura do token de acesso |
| `JWT_EXPIRES_IN` | não | `15m` | Validade do access token |
| `JWT_REFRESH_EXPIRES_IN` | não | `30d` | Validade do refresh token |
| `BCRYPT_ROUNDS` | não | `12` | Custo do hash de senha. Abaixo de 10 é fraco hoje |
| `CORS_ORIGENS` | não | `http://localhost:3000` | Origens autorizadas do front, separadas por vírgula. Em produção, listar só os domínios reais |

## Autenticação

| Variável | Obrigatória | Padrão | O que faz |
|---|:---:|---|---|
| `AUTH_OTP_DIGITOS` | não | `6` | Tamanho do código enviado por e-mail |
| `AUTH_OTP_MINUTOS` | não | `15` | Validade do código de recuperação de senha |
| `AUTH_VERIFICACAO_EMAIL_HORAS` | não | `24` | Validade do código de confirmação de e-mail |
| `AUTH_MAX_TENTATIVAS` | não | `5` | Senhas erradas antes de bloquear. Bloqueia a **conta**, não o IP — no campo, uma cidade inteira sai pelo mesmo IP de operadora |
| `AUTH_JANELA_TENTATIVAS_MINUTOS` | não | `15` | Janela em que as tentativas são contadas |
| `AUTH_BLOQUEIO_MINUTOS` | não | `30` | Duração do bloqueio |
| `AUTH_MAX_SESSOES` | não | `10` | Sessões simultâneas por usuário; ao estourar, a mais antiga é revogada |
| `AUTH_EXIGIR_EMAIL_VERIFICADO` | não | `false` | `true` impede login sem e-mail confirmado. Ligar depois que o envio de e-mail estiver em produção — antes disso, tranca todo mundo do lado de fora |

## Redis · cache · filas

**Redis é opcional.** Sem `REDIS_URL` o sistema sobe igual: cache cai para
memória e job executa no próprio processo. Isso mantém o `git clone && npm run
dev` de um dia sem infraestrutura. Em produção, a ausência é avisada no boot —
sem Redis não há retentativa de job, agendamento, nem limite de requisição
compartilhado entre instâncias.

| Variável | Obrigatória | Padrão | O que faz |
|---|:---:|---|---|
| `REDIS_URL` | não (**recomendada em produção**) | — | Conexão. Ausente = modo sem infraestrutura |
| `REDIS_PREFIXO` | não | `agropecas` | Prefixo das chaves. Combinado com o ambiente, evita que homologação e produção compartilhem cache no mesmo Redis |
| `CACHE_ATIVO` | não | `true` | Desligar é útil para depurar "isso está vindo de cache?" |
| `CACHE_TTL_PADRAO` | não | `60` | Segundos. Curto de propósito: dado velho em cache é pior que uma consulta a mais |
| `FILAS_TENTATIVAS` | não | `3` | Retentativas antes de dar o job por perdido |
| `FILAS_ESPERA_INICIAL_MS` | não | `5000` | Espera da 1ª retentativa; cresce exponencialmente |
| `FILAS_CONCORRENCIA` | não | `5` | Padrão por worker quando a fila não define o próprio |
| `FILAS_MANTER_CONCLUIDOS` | não | `500` | Histórico de sucesso. Sem teto, o Redis vira depósito |
| `FILAS_MANTER_FALHADOS` | não | `5000` | Histórico de falha — maior, porque é o que se investiga |

## Integrações

| Variável | Obrigatória | Padrão | O que faz |
|---|:---:|---|---|
| `VIACEP_BASE_URL` | não | `https://viacep.com.br/ws` | Consulta de CEP pelo servidor (evita expor o padrão de uso do usuário) |
| `GEOCODE_BASE_URL` | não | BigDataCloud | Geocodificação reversa (coordenada → município) |

## Armazenamento

| Variável | Obrigatória | Padrão | O que faz |
|---|:---:|---|---|
| `STORAGE_DRIVER` | não | `local` | `local` ou o provedor escolhido depois |
| `STORAGE_LOCAL_PATH` | não | `./uploads` | Pasta local dos arquivos |
| `STORAGE_PUBLIC_URL` | não | `http://localhost:3333/uploads` | Base pública das imagens |

## LGPD

| Variável | Obrigatória | Padrão | O que faz |
|---|:---:|---|---|
| `LGPD_RETENCAO_DIAS` | não | `180` | Prazo entre a anonimização da conta e o descarte físico |
| `LGPD_ENCARREGADO_EMAIL` | não | `contato@agropecasmt.com.br` | Contato do encarregado (DPO) exibido na política |
