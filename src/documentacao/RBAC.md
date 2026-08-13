# RBAC — papéis e permissões

Módulo de base em `src/rbac/`. **Não é feature**: as features consomem, não
redefinem.

```
src/rbac/
  recursos.js      o que existe no sistema (recurso × ação × escopo)
  permissoes.js    catálogo derivado dos recursos — 117 permissões
  papeis.js        papéis padrão e o que cada um recebe
  autorizacao.js   motor: pode() · exigir() · filtroDeEscopo()
  sincronizar.js   espelha o catálogo no banco, idempotente
  index.js         a API do módulo
```

---

## 1. As duas dimensões

Autorizar tem **duas perguntas**, sempre:

| Pergunta | Nome | Onde vive |
|---|---|---|
| Pode executar esta ação? | **capacidade** | chave da permissão |
| Sobre **quais registros**? | **escopo** | sufixo `.proprio` / `.todos` |

`anuncio.editar.proprio` edita o que é seu. `anuncio.editar.todos` edita o de
qualquer um. Quem tem só o primeiro e tenta editar anúncio alheio recebe **403**.

O escopo é aplicado **no servidor, sempre** — o front apenas esconde o botão,
nunca protege o dado.

---

## 2. O Admin manda em tudo

O papel `admin` recebe o coringa `*`. É decisão de produto, não atalho:

> A cliente pediu flexibilidade total. O sistema segue o fluxo que ela definiu
> — usuário publica, outro encontra, os dois conversam — mas o **Admin pode
> intervir em qualquer ponto desse fluxo**: criar, editar, apagar, ocultar,
> publicar em nome de terceiro, permitir e negar.

Na prática:

```js
pode(ctxAdmin, 'anuncio.editar', { donoId: 'de-outra-pessoa' });  // true
pode(ctxAdmin, 'qualquer.coisa.nova');                            // true
```

**O preço do poder é o rastro.** Toda ação de Admin grava em `logs_auditoria`
(com `em_nome_de` quando ele age representando alguém) e toda **leitura** de
dado pessoal de terceiro grava em `logs_acesso_dado`. Poder amplo sem registro
é o que transforma flexibilidade em risco — e é o que a LGPD cobra.

`sistema: true` nos papéis padrão impede que o próprio Admin apague o papel de
Admin e deixe a plataforma sem ninguém no controle.

---

## 3. Papéis padrão

| Papel | Para quem | Alcance |
|---|---|---|
| **admin** | Aline e quem ela designar | Tudo, sobre todos |
| **moderador** | Quem cuida de conteúdo | Anúncios, denúncias, suspensão. Sem configuração, plano ou RBAC |
| **suporte** | Atendimento | Leitura ampla + responder LGPD. Não remove nem bane |
| **usuario** | Todo cadastro | Só o que é seu |

**Produtor, Loja e Prestador não são papéis.** Os três têm o mesmo papel
`usuario` — todos anunciam, buscam e conversam. O que os diferencia é o
**Perfil** (campos, catálogo de serviços, área de atendimento), não a permissão.
Fazer disso três papéis criaria três listas quase idênticas para manter.

---

## 4. Como usar num service

```js
const { exigir, filtroDeEscopo, pode } = require('../../rbac');

// ação sobre um registro específico
async function editar(ctx, id, dados) {
  const anuncio = await Anuncio.findByPk(id);
  exigir(ctx, 'anuncio.editar', { donoId: anuncio.usuario_id }); // lança 403
  return anuncio.update(dados);
}

// listagem: o filtro entra na CONSULTA, não depois dela
async function listar(ctx) {
  const escopo = filtroDeEscopo(ctx, 'anuncio.ler', 'usuario_id');
  if (!escopo) return [];              // não pode nada
  return Anuncio.findAll({ where: { ...escopo, status: 'publicado' } });
}

// decisão de conteúdo (o que devolver no payload)
const podeVerContato = pode(ctx, 'anuncio.ver_contatos', { donoId: anuncio.usuario_id });
```

`filtroDeEscopo` devolve `{}` para quem tem `.todos` e `{ usuario_id }` para
quem tem `.proprio`. Filtrar **na consulta** e não na aplicação evita mandar o
banco inteiro pela rede antes de descartar.

---

## 5. Regras do módulo

1. **Nunca** `if (usuario.papel === 'admin')` num service. Use `pode()` — senão
   criar papel novo vira caçada a `if` pelo projeto.
2. **Nunca** escrever a string da permissão solta. Ela nasce de
   `recursos.js`; feature que precisa de ação nova adiciona lá primeiro.
3. **Escopo é obrigatório** em toda ação que incide sobre registro de terceiro.
4. **Ação de Admin sempre audita.** Se a feature não grava em `logs_auditoria`,
   ela está incompleta.

---

## 6. Comandos

```bash
npm run rbac:check   # audita o catálogo, sem banco. Falha se um papel citar permissão inexistente
npm run rbac:sync    # espelha catálogo → banco (idempotente, rodar a cada deploy)
npm run seed         # RBAC + plano gratuito + configurações iniciais
```

O sincronizador **não apaga** papel criado pela Admin na tela nem permissão
concedida à mão: o catálogo é o piso, não o teto. Permissão que sai do código é
apenas **avisada como obsoleta** — remover automaticamente derrubaria acesso em
produção sem aviso.

---

## 7. Ampliando

Funcionalidade nova = ação nova em `recursos.js`:

```js
anuncio: {
  acoes: {
    exportar: { escopos: ['proprio', 'todos'], descricao: 'Baixar anúncios em CSV' },
  },
},
```

Isso gera `anuncio.exportar.proprio` e `anuncio.exportar.todos` sozinho. Depois:
`npm run rbac:check` para validar e `npm run rbac:sync` para aplicar. O Admin já
passa a poder, pelo coringa; os outros papéis recebem se você adicionar em
`papeis.js` — ou pela tela de RBAC, quando ela existir.
