# LGPD no modelo de dados

Este arquivo é o contrato de privacidade do banco. Se um campo novo guarda dado
pessoal, ele entra aqui.

> ⚠️ Escrito por quem desenvolve, não por advogado. Antes de ir ao ar, revisar
> com jurídico — principalmente prazos de retenção e base legal.

## 1. Onde há dado pessoal

| Tabela | Dado | Base legal sugerida |
|---|---|---|
| `usuarios` | nome, e-mail, telefone, WhatsApp, IP (hash) | Execução de contrato |
| `perfis` | documento (CPF/CNPJ), razão social, bio, foto, endereço | Execução de contrato |
| `enderecos` | endereço completo, coordenada | Execução de contrato / consentimento para exibição exata |
| `anuncios` | localização, contato exibido | Consentimento (exibir_whatsapp) |
| `mensagens` | conteúdo escrito pelas partes | Execução de contrato |
| `busca_logs`, `tentativas_login`, `sessoes` | IP (hash), user-agent | Legítimo interesse (segurança) |
| `logs_auditoria`, `logs_acesso_dado` | ação do Admin sobre o titular | Obrigação legal / prestação de contas |

## 2. Princípios aplicados no schema

**Pseudonimização de IP.** Nenhuma tabela guarda IP em claro — só
`ip_hash` (SHA-256 com `SECURITY_IP_SALT`). Dá para detectar abuso e correlacionar
sessões sem manter rastro de localização identificável.

**Segredo nunca em claro.** `senha_hash`, `token_hash`, `codigo_hash`. Vazamento
da tabela não vira acesso às contas.

**Consentimento é histórico, não booleano.** `consentimentos` nunca é atualizado:
revogar cria nova linha com `aceito = false`. Um booleano no usuário não prova
*quando*, *de onde*, nem *a qual versão do texto* ele disse sim — e essa prova é
o que a lei pede. Por isso existe `documentos_legais` com versão e hash do texto.

**Exclusão é anonimização.** Apagar o usuário levaria junto anúncios e conversas
da outra parte, que têm interesse legítimo no histórico. O caminho é
`usuarios.anonimizado_em`: nome, e-mail e telefone viram valores neutros, o
registro permanece, e `excluir_definitivamente_em` marca o fim do prazo de
retenção (`LGPD_RETENCAO_DIAS`).

**Leitura também é evento.** `logs_acesso_dado` registra o Admin **abrindo** dado
de terceiro — cadastro, documento, conversa denunciada. Auditoria de alteração
não cobre isso, e é justamente a leitura que gera o risco.

## 3. Direitos do titular

`solicitacoes_titular` implementa o art. 18: acesso, correção, exclusão,
portabilidade, revogação, anonimização e oposição. Dois campos são o coração:

- **`identidade_verificada_em`** — entregar dado pessoal sem confirmar quem pede
  é o próprio vazamento
- **`prazo_em`** — a lei dá prazo de resposta; sem fila registrada não há como
  cumprir nem comprovar

## 4. Retenção sugerida (confirmar com jurídico)

| Dado | Prazo | Por quê |
|---|---|---|
| Conta anonimizada | `LGPD_RETENCAO_DIAS` (180) | Defesa em eventual disputa |
| `tentativas_login` | 90 dias | Segurança; depois disso não serve mais |
| `busca_logs` com identificação | 12 meses | Produto; passar disso é acúmulo |
| `logs_auditoria` | 5 anos | Prestação de contas de ação administrativa |
| `mensagens` de conversa encerrada | enquanto a conta existir | Prova em disputa entre as partes |
| `arquivos` órfãos | 30 dias (`descartar_em`) | Faxina do storage |

## 5. Decisões pendentes (produto, não código)

1. **Localização do produtor**: padrão aproximado, podendo abrir por escolha —
   já suportado por `perfis.exibir_endereco_exato` e
   `anuncios.precisao_localizacao`. Falta confirmação da cliente.
2. **O Admin lê conversa por padrão ou só mediante denúncia?** O schema suporta
   as duas (`conversas.moderada_por` + `logs_acesso_dado.denuncia_id`), mas
   *só mediante denúncia* é bem mais defensável — e precisa constar nos Termos,
   que hoje não mencionam chat.
3. **Política de Privacidade** ainda não existe como documento separado — hoje é
   uma seção dos Termos. `documentos_legais` já aceita o tipo.
