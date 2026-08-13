# Feature `localizacao`

Tudo que é endereço e distância: consulta de CEP, geocodificação reversa,
catálogo de estados e municípios, gravação do endereço de perfil e anúncio, e
o cálculo de distância — com a privacidade do produtor aplicada em todas as
saídas.

```
src/features/localizacao/
  localizacao.routes.js               mapa da feature: rota, limite, validação
  localizacao.controller.js           só HTTP
  localizacao.validators.js           esquemas de entrada
  localizacao.mapper.js               model → JSON, lista branca
  localizacao.constants.js            TTLs, raios, alvos, ações RBAC por alvo
  localizacao.cache.js                chaves de cache da feature

  localizacao.cep.service.js          ViaCEP + cache + resolução do município
  localizacao.geocode.service.js      coordenada → município (BigDataCloud)
  localizacao.territorio.service.js   estados, municípios e resolução por nome
  localizacao.endereco.service.js     escrita do endereço, escopo e transação
  localizacao.privacidade.service.js  quem vê o quê — LGPD e regra da cliente
  localizacao.distancia.service.js    Haversine sobre alvos + filtro por raio

src/providers/http.js                 GET com timeout, falha vira 503 tratado
src/providers/viacep/index.js         só sabe falar ViaCEP
src/providers/geocode/index.js        só sabe falar BigDataCloud
src/utils/geo.js                      Haversine, caixa de raio, ofuscação (puro)
seeders/20260812000000-estados-e-municipios-mt.js
```

---

## 1. Endpoints

Base: `/api/v1/localizacao`

| Método | Rota | Permissão | O que faz |
|---|---|---|---|
| `GET` | `/cep/:cep` | pública (limite 40/min) | Consulta o CEP no ViaCEP, com cache de 30 dias |
| `GET` | `/reverso?latitude=&longitude=` | pública (limite 40/min) | Coordenada → município |
| `GET` | `/estados` | pública | 27 UFs, cache de 7 dias |
| `GET` | `/municipios?uf=&busca=` | pública | Municípios paginados, busca sem acento |
| `POST` | `/distancia` | pública, autenticação opcional | Distância da origem até anúncios/perfis |
| `GET` | `/enderecos/:id` | pública, autenticação opcional | Endereço com a privacidade aplicada |
| `POST` | `/enderecos` | autenticado — `perfil.editar` ou `anuncio.editar` conforme o `alvo` | Cria ou atualiza o endereço do alvo |

**Por que `POST /enderecos` não tem `autorizar()` na rota:** o mesmo endpoint
grava endereço de perfil e de anúncio, e a ação exigida depende do corpo. A
verificação real é `exigir(ctx, acao, { donoId })` no service, feita depois de
carregar o alvo — que é o único momento em que se sabe de quem ele é. Um
`autorizar()` fixo na rota daria falsa sensação de proteção.

---

## 2. As decisões que valem explicação

### A consulta de CEP é feita pelo servidor, não pelo navegador

Três motivos, em ordem de importância:

1. **Privacidade.** Chamar o ViaCEP do browser entrega ao terceiro o IP do
   usuário e o padrão de uso dele — quais CEPs pesquisou e quando.
2. **Cache.** CEP praticamente não muda. Com a chamada no servidor, o segundo
   usuário que digita o mesmo CEP não gera chamada nenhuma.
3. **Um lugar só para tratar a queda.** ViaCEP fora vira 503 com mensagem útil
   em um arquivo, não em cada tela do front.

### Chamada externa só em `src/providers/`

`providers/http.js` existe por um motivo específico: **timeout**. `fetch` sem
`AbortSignal` espera para sempre, e APIs públicas gratuitas não caem — elas
travam. Uma conexão pendurada segura o worker, a requisição não responde nunca,
e o sintoma que chega ao suporte é "o site está lento", não "o ViaCEP está
fora". Teto de 4 s: o ViaCEP responde em ~300 ms quando está bem, e acima disso
quem preenche um formulário já desistiu e digitou na mão.

Falha de rede vira `AppError` 503 `INTEGRACAO_INDISPONIVEL` com a mensagem
"preencha os dados manualmente". **O CEP é conveniência, nunca requisito** —
nenhum cadastro pode ficar impossível porque um terceiro caiu.

### TTL de dias no cache

| Chave | TTL | Por quê |
|---|---|---|
| `cep:<cep>` | 30 dias | Logradouro novo aparece uma vez por ano |
| `cep` inexistente | 1 dia | Também vale cachear (é a resposta de quem erra um dígito e insiste), mas CEP novo é criado com mais frequência do que CEP muda |
| `geo:<lat>:<lon>` | 30 dias | Município não muda de lugar |
| `catalogo:estados` | 7 dias | Só muda por seeder |
| `catalogo:municipios:*` | 1 dia | Só muda por seeder |

A alternativa ao TTL longo é bater numa API pública e gratuita a cada tecla do
formulário — e levar bloqueio de IP justamente no dia de pico.

### A coordenada enviada ao geocoder é arredondada

3 casas decimais (~110 m) antes de sair para a BigDataCloud. Basta de sobra para
acertar o município e evita entregar a porteira exata de um produtor a uma
empresa estrangeira. O mesmo arredondamento vira a chave de cache: um GPS nunca
devolve o mesmo ponto duas vezes, e sem a grade a taxa de acerto seria zero.

### Ofuscação de coordenada — o núcleo do módulo

Regra da cliente (Maturacao/05 §9.3): loja e prestador são ponto comercial e
têm endereço exato; **o produtor anuncia de casa**, e `exibir_endereco_exato`
nasce `false` no model. `localizacao.privacidade.service.js` é quem faz esse
campo valer na resposta.

Quando a localização é aproximada, saem município, bairro e uma coordenada
**deslocada** — nunca CEP, logradouro, número, complemento ou referência (CEP
identifica a rua; logradouro e número identificam a casa).

Duas decisões em `utils/geo.ofuscarCoordenada` que parecem detalhe e não são:

- **O deslocamento é determinístico**, derivado do id do endereço. Com jitter
  aleatório por requisição, bastaria pedir o mesmo anúncio mil vezes e tirar a
  média para recuperar o centro real com precisão melhor que o raio — a
  proteção seria ruído cancelável, ou seja, decoração.
- **A distribuição usa `sqrt`** da fração aleatória, para o ponto cair uniforme
  na *área* do disco. Sem isso o deslocamento se concentra perto do centro.

Raio padrão: **3 km** — maior que a maioria das sedes rurais de MT, menor que a
distância típica entre propriedades vizinhas. O pino cai "na região certa", que
é o que o comprador precisa para decidir se vale a viagem.

### Distância aproximada sai em faixa de 5 km

Consequência direta da decisão anterior: distância *exata* a partir de três
origens diferentes recupera o ponto real por trilateração, mesmo com o pino
deslocado. Por isso `distanciaDivulgavel` arredonda para múltiplos de 5 km
quando o alvo é aproximado. O dono e o Admin recebem o valor exato.

### Distância é calculada no servidor

Maturacao/05 §9.2 pede a distância **só quando o usuário clica** — geolocalizar
no carregamento é invasivo e a maioria nega por reflexo. E o cálculo não pode ir
para o front: mandar a coordenada real do anúncio para o navegador calcular
seria contornar a própria ofuscação pelo caminho mais óbvio.

### Caixa envolvente no banco, Haversine na aplicação

`filtroDeProximidade` devolve um `BETWEEN` em latitude/longitude, que usa o
índice composto já existente. Haversine em SQL faria varredura completa. Os
cantos da caixa trazem alguns registros a mais — quem descarta é o cálculo exato
depois, sobre um punhado de linhas.

### A precisão é derivada da origem, não recebida do cliente

Aceitar `precisao: 'exata'` do corpo deixaria qualquer um marcar como exato um
ponto que é o centro da cidade — e o comprador viajaria 40 km confiando num selo
emitido pelo próprio sistema. `origem` `coordenada`/`mapa` → exata; `cep` e
`municipio` → aproximada.

### Endereço sem coordenada herda a sede do município

Um endereço sem `latitude`/`longitude` some do mapa e do cálculo de distância —
metade do valor do produto. O ViaCEP não devolve coordenada, então a sede do
município (semeada com o dado do IBGE) é o melhor palpite disponível, marcado
como aproximado.

### Abrir o endereço exato grava consentimento

`exibirEnderecoExato` não é preferência de interface: é consentimento LGPD
(art. 8º, §1º — precisa ser *demonstrável*). Ao alterar o campo, a feature grava
linha em `consentimentos` via `auth.consentimento.service`, com a origem da
coleta. Leitura de endereço exato de terceiro por usuário identificado grava em
`logs_acesso_dado` com `recurso: 'endereco_exato'`.

### Rate limit mais apertado nas rotas de terceiro

40/min em `/cep` e `/reverso`, contra 300/min da leitura comum. Sem isso as duas
viram proxy gratuito para o ViaCEP e a BigDataCloud: alguém aponta um script
para cá, **quem leva o bloqueio de IP somos nós**, e o cadastro para de
funcionar para os usuários reais. O custo aqui não é o nosso banco — é a nossa
reputação com o terceiro.

### Só MT tem municípios semeados

Os 27 estados entram inteiros (são baratos, e quem mora em Rondonópolis compra
em Goiás — o filtro por UF precisa das siglas existindo). Municípios: só os 142
de Mato Grosso. Carregar os 5.570 do país encheria o `select` do cadastro com
dado que ninguém usa no MVP. O seeder é idempotente (casa por `codigo_ibge`) e
o `down` se recusa a apagar quando há endereços vinculados.

---

## 3. Pendências conhecidas

1. **Não há recurso `endereco` no RBAC.** O escopo hoje vem emprestado de
   `perfil.editar`/`perfil.ler` e `anuncio.editar`/`anuncio.ler`, que é
   semanticamente correto (o endereço não tem dono próprio) mas impede dar a um
   moderador o poder de corrigir endereço sem lhe dar o perfil inteiro.
2. **A rota não está registrada em `src/routes/index.js`** — arquivo
   compartilhado, fora do alcance deste módulo. Falta a linha
   `router.use('/v1/localizacao', require('../features/localizacao/localizacao.routes'));`.
   Enquanto isso, a suíte de teste monta a própria aplicação.
3. **Raio de ofuscação é constante do código.** Faria sentido virar
   `configuracoes` (`localizacao.raio_ofuscacao_metros`), para o Admin ajustar
   sem deploy. Não foi feito porque nenhuma tela pede isso ainda.
4. **§9.3 do documento da cliente está marcado como "decisão pendente".** O
   implementado é o padrão seguro descrito lá (produtor aproximado, comércio
   exato) — precisa de confirmação dela.
5. **Mapa com camadas próprias exige chave da Maps JavaScript API** (§9.4). O
   `embed` atual não exige, e o pino arrastável do cadastro vai exigir. Decisão
   comercial pendente.
6. **`GET /enderecos/:id` só resolve o dono via `Perfil`.** Endereço vinculado
   apenas a um anúncio (sem perfil apontando para ele) cai no caminho
   aproximado, que é o padrão seguro — mas o dono não se reconhece. Some quando
   a feature de anúncio existir e trouxer o dono junto.
