# Mapa do banco

49 tabelas. Cada model tem no topo do arquivo o porquê de existir; aqui está a
visão de conjunto.

## Identidade e acesso (7)

| Model | Tabela | Papel |
|---|---|---|
| `Usuario` | `usuarios` | Identidade e credencial. Só login, contato e estado da conta |
| `Perfil` | `perfis` | O rosto público: produtor, loja ou prestador |
| `Papel` · `Permissao` | `papeis` · `permissoes` | RBAC em dado, não em `if` |
| `UsuarioPapel` · `PapelPermissao` | — | N:N. Um usuário acumula papéis |
| `Sessao` | `sessoes` | Refresh token por dispositivo (hash, nunca o token) |

**Por que `Usuario` e `Perfil` são separados:** um mesmo CNPJ pode ser loja
**e** prestador; e um Admin também anuncia. Fundir os dois obrigaria a duplicar
credencial ou a inventar coluna nula para cada caso.

## Localização (3)

`Estado` · `Municipio` · `Endereco`

Endereço guarda **sempre as duas coisas**: texto (para filtro) e coordenada
(para mapa e distância). `origem` registra como o dado chegou — CEP, coordenada,
pino no mapa ou só município.

## Catálogo (7)

`Categoria` · `Marca` · `Maquina` · `Servico` · `PerfilServico` · `PerfilMarca` ·
`PerfilAreaAtendimento` · `PerfilHorario`

Tudo isso é **tabela e não enum** porque o Admin gerencia (documento da cliente,
§2.4). `Maquina` é o que sustenta o "Busque por máquina": quem não sabe o nome
da peça sabe o trator que tem.

## Anúncios (8)

`Anuncio` · `AnuncioFoto` · `AnuncioAtributo` · `AnuncioMaquina` ·
`AnuncioHistorico` · `AnuncioMetricaDiaria` · `AnuncioContato` · `Favorito`

`AnuncioContato` guarda QUEM pediu contato e quando — a métrica diária só diz
quantos. É o que permite ao anunciante ver quem o procurou mesmo quando a
conversa foi para o WhatsApp e nunca voltou.

- Preço em **centavos** (inteiro)
- Localização **desnormalizada** no anúncio: a busca por região é a consulta
  mais frequente e não pode depender de join
- Ficha técnica em **chave/valor**: peça agrícola tem atributo imprevisível
- Métrica **agregada por dia**: evento cru cresce sem limite e ninguém consulta

## Conversas (4)

`Conversa` · `ConversaParticipante` · `Mensagem` · `BloqueioUsuario`

Toda conversa nasce de um **anúncio** — é ele que dá contexto e permite moderar
com referência. O estado de leitura é **por participante**: o que um leu não é o
que o outro leu.

## Moderação e avisos (5)

`Denuncia` · `Notificacao` · `NotificacaoPreferencia` · `TemplateNotificacao` ·
`LogAuditoria`

`TemplateNotificacao` tira o texto dos avisos de dentro do código: corrigir uma
vírgula de e-mail não pode exigir deploy, e a cliente precisa ajustar o tom.

Uma tabela de denúncia para todos os alvos (anúncio, perfil, mensagem) — o Admin
tem uma fila só, não três telas.

## LGPD (5)

`DocumentoLegal` · `Consentimento` · `SolicitacaoTitular` · `LogAcessoDado` ·
campos de anonimização em `Usuario`

Ver [LGPD.md](LGPD.md).

## Busca e produto (2)

`BuscaLog` · `TermoPopular`

Busca com **zero resultado** é a informação mais valiosa do produto: é pedido de
compra que ninguém atendeu, e é o argumento para chamar lojista novo.

## Planos — preparado, não usado (4)

`Plano` · `PlanoLimite` · `Assinatura` · `UsoMedido`

O MVP é gratuito e **nenhum gateway entra aqui**. As tabelas existem para que
ligar cobrança um dia seja inserir dado, não refatorar o núcleo. Todo cadastro
nasce com assinatura do plano `gratuito_mvp`, com limites nulos (= ilimitado).

## Infra (3)

`Configuracao` · `Arquivo` · `TentativaLogin`

`Arquivo` é o inventário do storage: sem ele, imagem removida vira lixo pago
para sempre e não há como cumprir exclusão pedida pelo titular.

## Convenções

- **PK `UUID`** em tudo: id sequencial exposto entrega volume de negócio ao concorrente
- **`snake_case`** em tabela e coluna; `criado_em` / `atualizado_em` / `removido_em`
- **Soft delete** (`paranoid`) onde há histórico a preservar; delete real só em tabela de junção
- **Campos `*_normalizado`** guardam a versão sem acento e minúscula: a busca do usuário nunca vem acentuada
- **Contadores desnormalizados** (`total_*`) para não fazer `COUNT` em listagem
