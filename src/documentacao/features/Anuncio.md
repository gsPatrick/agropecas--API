# Anúncio

Entidade central do produto. Os **três perfis anunciam** — o produtor publica a
peça que sobra, a loja publica estoque, o prestador publica serviço
(`Maturacao/05`, §2 e §7.1). O contato é direto entre as partes; a plataforma
conecta e divulga, não intermedeia.

---

## 1. Arquivos

| Arquivo | O que faz |
|---|---|
| `anuncio.routes.js` | mapa da feature: rotas, limites, validação e capacidade |
| `anuncio.controller.js` | só HTTP |
| `anuncio.validators.js` | esquemas de entrada |
| `anuncio.mapper.js` | model → JSON por lista branca (é onde mora a regra de privacidade) |
| `anuncio.constants.js` | vocabulários fechados: transições, chaves de configuração, TTL |
| `anuncio.cache.js` | chaves de cache da feature |
| `anuncio.relacoes.js` | os `include` das consultas — a garantia de "uma consulta" |
| `anuncio.campos.js` | tradução de campo, tabelas filhas e invalidação (comum a criar/editar) |
| `anuncio.acesso.service.js` | localizar + escopo + como negar (404 × 403) |
| `anuncio.politica.service.js` | prazo, teto de fotos e quota do plano |
| `anuncio.criacao.service.js` | criar (inclusive em nome de terceiro) |
| `anuncio.edicao.service.js` | editar |
| `anuncio.publicacao.service.js` | publicar, pausar, renovar |
| `anuncio.retirada.service.js` | ocultar (moderação) e remover (soft delete) |
| `anuncio.historico.service.js` | trilha de estado + contador do perfil |
| `anuncio.consulta.service.js` | vitrine, meus anúncios, detalhe |
| `anuncio.parecidos.service.js` | carrossel "anúncios parecidos" |
| `anuncio.foto.service.js` | vincular, desvincular, reordenar, capa |
| `anuncio.metrica.service.js` | visualização, contato, painel do anunciante |
| `src/filas/trabalhos/anuncio.trabalho.js` | `reindexar`, `registrarVisualizacao`, `registrarContato`, `expirar` |

Nenhum service passa de ~200 linhas. Quando um assunto cresceu (parecidos,
retirada, histórico), virou arquivo — não uma seção a mais no arquivo grande.

---

## 2. Endpoints

Prefixo: `/api/v1/anuncios`.

| Método | Rota | Permissão | Observação |
|---|---|---|---|
| GET | `/` | — (público) | vitrine: só `publicado` |
| GET | `/:id` | — (público) | detalhe; dono/Admin recebem bloco de gestão |
| GET | `/:id/parecidos` | — (público) | mesma categoria, marca ou máquina |
| POST | `/:id/contato` | — (público) | clique no WhatsApp não exige login |
| GET | `/meus` | `anuncio.ler` | todos os status, inclusive rascunho |
| POST | `/` | `anuncio.criar` (+ `anuncio.criar_em_nome_de`) | nasce rascunho |
| PATCH | `/:id` | `anuncio.editar` | escopo conferido pelo dono do registro |
| DELETE | `/:id` | `anuncio.remover` | soft delete |
| POST | `/:id/publicar` | `anuncio.publicar` | exige completude + quota |
| POST | `/:id/pausar` | `anuncio.pausar` | |
| POST | `/:id/renovar` | `anuncio.renovar` | reabre prazo e posição |
| POST | `/:id/ocultar` | `anuncio.ocultar` (escopo `todos`) | motivo obrigatório |
| POST | `/:id/fotos` | `anuncio_foto.enviar` | vincula `Arquivo` já enviado pelo `midia` |
| PATCH | `/:id/fotos/ordem` | `anuncio_foto.enviar` | |
| PATCH | `/:id/fotos/:fotoId/capa` | `anuncio_foto.enviar` | |
| DELETE | `/:id/fotos/:fotoId` | `anuncio_foto.remover` | |
| GET | `/:id/historico` | `anuncio.ler` | trilha de estado |
| GET | `/:id/metricas` | `anuncio.ver_metricas` | série diária + totais |
| GET | `/:id/contatos` | `anuncio.ver_contatos` | quem procurou |

A **capacidade** é conferida na rota; o **escopo** (`proprio` × `todos`) é
conferido no service, com `exigir(ctx, acao, { donoId })`. Não existe
`if (admin)` em lugar nenhum da feature.

---

## 3. Decisões que valem explicação

**O anúncio nasce rascunho e pode nascer incompleto.** Quem cadastra está no
pátio, com o celular na mão e a peça na frente. Exigir categoria, foto e
localização para *salvar* faria o usuário perder o que digitou. As exigências
são cobradas em `publicar` — é ali que o anúncio passa a ocupar a vitrine.

**404 e 403 não são intercambiáveis, e a escolha tem regra.** Anúncio
`publicado` de terceiro responde **403**: ele já é público, negar a edição não
revela nada e a mensagem honesta evita chamado de suporte. Fora da vitrine
(rascunho, pausado, oculto) responde **404**, igual a um id inexistente — senão
bastaria varrer UUIDs para descobrir o que a concorrência prepara para lançar.

**Contato só sai com consentimento.** `exibir_whatsapp = false` zera o campo no
mapper, não na tela. É consentimento LGPD colhido no cadastro, e quem recusou
continua contactável pelo chat interno (`Maturacao/05`, §8.1). Coordenada exata
depende de `exibir_endereco_exato`: produtor rural anuncia de dentro da
propriedade, e publicar o pino de quem não pediu isso expõe onde a pessoa dorme
(§9.3).

**A visualização não é `UPDATE` síncrono.** Duas barreiras antes de contar:
janela de 6h por `hash de IP + anúncio` no cache (F5 não vira métrica) e fila
para escrever o agregado. Incrementar a linha a cada acesso serializaria o
anúncio popular no exato momento em que ele não pode ficar lento. O IP nunca é
guardado em claro.

**Prazo de expiração e limite de anúncios são DADO, não código.** Prazo vem de
`configuracoes['anuncio.dias_validade']` (60 dias no seed); a quota vem de
`plano_limites['anuncios.ativos']` do plano da assinatura ativa — `null` é
ilimitado, que é o caso de todos no MVP (`gratuito_mvp`). Quando existe teto
também em `configuracoes['anuncio.max_ativos_por_usuario']`, **vence o menor**:
a configuração global é freio de emergência do Admin e não pode ser contornada
por um plano generoso.

**A quota é do dono, não de quem clicou.** O Admin publicando em nome de
terceiro (§2.4) não empresta o próprio limite.

**`busca_texto` e `titulo_normalizado` são recalculados por job.** A coluna
alimenta o índice trigram `idx_anuncios_busca_trgm`; normalizar quatro campos é
barato, mas não é trabalho que o usuário deva esperar ao salvar.

**A vitrine é a consulta mais frequente do produto** e a assinatura dela —
`status = 'publicado'` ordenado por `publicado_em DESC` — é exatamente a do
índice parcial `idx_anuncios_vitrine`. Mudar a ordem padrão sem olhar o índice
troca um index scan por um seq scan na página inicial.

**Cache curto, invalidação na escrita.** Vitrine 60s, detalhe 120s, parecidos
300s. Toda escrita remove o detalhe e apaga o prefixo das listas — lista com
filtro tem assinatura própria e seria impossível saber quais dela um anúncio
novo afeta. O cache guarda **objeto mapeado**, nunca instância do Sequelize.

**Remover é soft delete com `status = 'removido'`.** Conversas, denúncias e
auditoria continuam apontando para um registro que existe; apagar de verdade
quebraria a trilha justamente nos casos em que ela é necessária.

**Moderação prévia está desligada** (`anuncio.moderacao_previa = false`): o
anúncio entra no ar direto e a intervenção do Admin é *a posteriori*, que é o
caminho mais leve para começar (§7.4). Ligar é alterar dado, não código.

---

## 4. Filas

| Trabalho | Fila | Quando |
|---|---|---|
| `anuncio.reindexar` | `indexacao` | após criar/editar; sem `anuncioId`, varre em lote |
| `anuncio.registrarVisualizacao` | `indexacao` | visita que passou pela janela antiflood |
| `anuncio.registrarContato` | `indexacao` | clique no WhatsApp / início de conversa |
| `anuncio.expirar` | `manutencao` | periódico, `20 * * * *` (registrado em `worker.js`) |

O agregado diário usa `INSERT ... ON CONFLICT (anuncio_id, data) DO UPDATE`, que
soma sem ler antes — duas visitas simultâneas não se sobrescrevem.

Notificações usam o contrato comum (`notificacao.criar`) e são enfileiradas em:
publicação por terceiro, ocultação por moderação e expiração.

---

## 5. Dependências de outros módulos

- **`midia`** — o upload é dele. Esta feature recebe `arquivos[]` com ids de
  `Arquivo` já existentes e confere que pertencem a quem está anexando. Ao
  vincular, marca `referencia_tipo/referencia_id` e limpa `descartar_em`; ao
  desvincular, devolve o arquivo à faxina com 7 dias de carência.
- **`configuracao`** e **`plano`** — enquanto não existirem, `anuncio.politica.service.js`
  lê `configuracoes` e `plano_limites` pelos models. Quando existirem, só as
  funções de leitura desse arquivo mudam.
- **`notificacao`** — enfileirado mesmo antes de existir; a fila registra erro
  em log e não quebra a operação de negócio.
- **`catalogo`** — categoria, marca, máquina e município vêm de lá.

---

## 6. Pendências conhecidas

1. **A rota não está registrada em `src/routes/index.js`** (arquivo do
   orquestrador). Falta a linha:
   `router.use('/v1/anuncios', require('../features/anuncio/anuncio.routes'));`
   A suíte de teste monta o router num app próprio para não depender disso.
2. **Ações de moderação `anuncio.aprovar` / `anuncio.reprovar`** existem no RBAC
   e não têm endpoint aqui — pertencem ao módulo de moderação/admin.
3. **`destaque_ate`** é lido (o mapper devolve `destaque`) mas nada o escreve:
   depende de planos pagos, fora do MVP.
4. **Busca textual** (`?q=`) não está nesta feature: é do módulo `busca`, que
   consome `busca_texto` e o índice trigram alimentados aqui.
5. **Favoritos** incrementam `total_favoritos`; o módulo `favorito` é quem
   escreve essa coluna.
6. Em aberto no documento da cliente (§7.4): peça usada vira categoria própria
   ou fica no campo `condicao`? Hoje está em `condicao`, como o model previa.
