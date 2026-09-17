# VEREDITO — Campeonato de camadas do painel Suinco

Juiz: Fable 5.1, com mandato de critério de interface (chefe técnico).
Estado de tudo neste documento: ⬜ proposta. Nada commitado, nada publicado.

Provas geradas por mim nesta sessão (não confiei em print de competidor):
`camp/juiz/` — `1440_<comp>_<tema>_<aba>.png` (recorte 1140×700 igual ao do briefing),
`1440_<comp>_<tema>_<aba>_full.png` (viewport 1440×900 inteiro, com nav e header),
`<comp>_<tema>_<aba>_full.png` (celular 390×900), `print_<comp>.png` (mídia PRINT),
`medidas_1440.json` (posição, corte, contraste e fonte de cada peça, por camada e tema).
Scripts: `camp/juiz_prints.py`, `camp/juiz_medidas.py`, `camp/juiz_print_leak.py`.
Login usado: "Entrar só neste aparelho" (a API 3010 estava fora do ar; não subi outra).

---

## 0. Resumo em dez linhas

1. **Cinco camadas caem no chão de segurança**: Apple, Stripe, Suíço, Linear, Bloomberg.
2. **Cinco passam no chão**: Binance, Meta, Controle, Anthropic, Vercel.
3. **Nenhuma das cinco é o produto que eu entregaria** como "padrão 2027". Duas são
   invisíveis (Anthropic, Meta), uma abandona a marca (Vercel), uma tem uma ideia boa
   com execução defeituosa (Controle), e a melhor (Binance) é um esboço certo com
   acabamento errado.
4. **Campeão de base: Binance** — a única que anda na direção do que o dono pediu
   (compacto, plano, denso, sem vidro) mantendo azul-marinho e dourado.
5. **Decisão: campeão HÍBRIDO, chamado "Tema 2027"**, construído por etapas em arquivos
   separados (seção 6), com o esqueleto da Binance e cinco decisões roubadas de perdedores.
6. O buraco da faixa de indicadores não pesou contra ninguém (correção do briefing vem por cima).
7. Duas camadas afirmaram "tudo em @media screen" e não estava: Stripe e Suíço vazam para o PDF
   (`print_stripe.png`, `print_suico.png` diferem do `print_base.png` pixel a pixel).
8. Uma camada afirmou "ambos os temas legíveis" e o botão Excluir no tema claro mede 1,13:1 (Linear).
9. Uma camada afirmou "#nav já é fixed, só positioning context" e empurrou a página 484px (Apple).
10. Uma camada afirmou "nenhum texto cortado" e cortou "Outra carga" em seis botões (Bloomberg).

---

## 1. Como julguei

- Mesmo HTML, mesma semente de 16 cargas, mesma sessão, para as dez camadas e para a base.
  Cada camada entra por `add_style_tag` e sai antes da próxima. Dois temas, 1440 e 390.
- **Critério 1 (nada muda de lugar)**: caixa delimitadora (`getBoundingClientRect`) de header,
  nav, `#main`, primeiro card, faixa de indicadores, `thead`, primeira e segunda linha, em cada aba.
  Delta contra a base em `medidas_1440.json`.
- **Critério 2 (nada some)**: `scrollWidth > clientWidth` em badge, botão, rótulo de indicador,
  cabeçalho de coluna e aba; cor de borda/fundo computada dos inputs da Torre.
- **Critério 3 (legível)**: contraste WCAG calculado no navegador (cor de texto contra o primeiro
  ancestral opaco), 12 pares por tela, dois temas; amostra de pixel onde o cálculo não vê degradê.
- **Critério 4 (papel)**: leitura de cada `camada.css` + prova mecânica: `juiz_print_leak.py`
  monta um trecho do relatório com as MESMAS classes que `app.js` usa dentro de `.print-page`
  (`.stat-box/.stat-label/.stat-num`, `th/td`, `.c-placa/.c-carga/.c-peso`, `.badge`,
  `.et-mini`, `.btn`), renderiza em mídia `print` com `styles.css + camada.css` e compara com o
  render sem camada. **Isto é exatamente o que `coletarCssDoPainel()` manda para `gerarPdf()`**:
  a função junta TODOS os `<style>` da página, e `page.pdf()` do Playwright renderiza em `print`.
  Regra fora de `@media screen` chega ao papel, sim.
- **Critério 5 (cabe)**: `scrollWidth` do documento em 1440 nas quatro abas. Todas as dez passaram.

---

## 2. Classificação

| # | Camada | Chão | Onde ficou |
|---|--------|------|-----------|
| 1 | **binance** | passa | Campeão de base. Única que muda a cara na direção pedida sem trair a marca. Rejeitada como está (seção 4). |
| 2 | meta | passa | Suavização correta (card sem borda + elevação, aba ativa por preenchimento). Invisível como "cara nova". |
| 3 | controle | passa | Uma ideia operacional de verdade (urgência em Aguardando Veículo). Execução com defeito: a barra vermelha aparece em TODAS as células da linha. |
| 4 | anthropic | passa | Contenção certa (botão chapado, filete de cabeçalho mais fino). É conserto, não upgrade. |
| 5 | vercel | passa | Limpa e legível, mas preto/branco puro: deixa de ser o painel da Suinco. |
| 6 | linear | **eliminada (3)** | Melhor ideia isolada do campeonato (cor de estrutura ≠ cor de marca). Um único erro a derruba. |
| 7 | bloomberg | **eliminada (2)** | Botões em caixa alta cortam o rótulo de ação. Terminal âmbar/mono também não é a Suinco. |
| 8 | stripe | **eliminada (1, 2, 4)** | Campos de tabela invisíveis, página cresce 163px, vaza para o PDF. |
| 9 | suico | **eliminada (1, 4)** | Card sem padding lateral desloca faixa e tabela; vaza para o PDF. |
| 10 | apple | **eliminada (1)** | Nav deixa de ser fixa: página inteira desce 484px. |

---

## 3. Eliminados — critério e prova

### Apple — critério 1
`apple/camada.css`, bloco `@media(min-width:821px){ #nav{ ... position:relative } }`.
`#nav` é `position:fixed` no `styles.css` (linha 503); `relative` vence por vir depois e a barra
lateral entra no fluxo do documento. Medido: `nav` altura −344px, `#main`/card/faixa/tabela
**+484px em y nas quatro abas** (`medidas_1440.json`, `apple.escuro.*.pos`).
Prova visual: `juiz/1440_apple_escuro_torre.png` e o PRÓPRIO print do competidor,
`apple/prints/apple_torre.png` — 385px de azul vazio acima do card. Ele tirou o print e não olhou.

### Stripe — critérios 1, 2 e 4
- (2) `td > input:not([type="date"])...{ background:transparent; border-color:transparent }`.
  Medido na Torre: `border: rgba(0,0,0,0)`, `bg: rgba(0,0,0,0)` nos dois temas. O campo Peso,
  vazio, **não existe visualmente** — ver `stripe/prints/stripe_torre.png`, coluna "Peso (kg)":
  nada. Quem opera no celular não tem hover; o campo só aparece depois de tocar onde não se vê nada.
- (1) `td{ padding:9px 10px }` e `.stat-label` em caixa alta: `#main` +163px na Torre, +169px em
  Indicadores; linhas +11px; `thead` +9px. É o oposto de "compacto".
- (4) Arquivo sem `@media screen`. `juiz/print_stripe.png` ≠ `juiz/print_base.png` (região
  50,137–680,404): rótulos dos indicadores em caixa alta, placa e nº de carga em negrito,
  badge com canto diferente. O `porque.md` diz "nada aqui vaza pro relatório — conferido lendo o
  CSS". Conferiu errado: `.print-page th/td` só vence nas propriedades que declara com `!important`.

### Suíço — critérios 1 e 4
- (1) `.card{ padding:20px 0 18px }`: faixa e tabela **x −17px, largura +34px**; `#main` +64px
  (Torre), +186px (Indicadores). `.bento{ grid-template-columns:repeat(auto-fit,minmax(138px,1fr)) }`
  reescreve a grade de TODA faixa, inclusive a esteira de Devoluções que o `styles.css` pede
  para não mudar.
- (4) Arquivo sem `@media screen`. `juiz/print_suico.png`: cada cartão de indicador do
  RELATÓRIO ganhou uma barra colorida à esquerda (`.stat-box::after` novo, e o `@media print`
  da base só esconde `::before`), título de seção em caixa alta com sublinhado, tabela 20px
  mais abaixo. Documento alterado.

### Linear — critério 3
`linear/camada.css`, seção 3: `.btn, th, ...{ background-image:linear-gradient(180deg, var(--luz-topo), transparent 60%) }`
com `--luz-topo: rgba(255,255,255,.75)` no tema claro. Sobre o botão vinho, 75% de branco.
Medido em `juiz/1440_linear_claro_torre_full.png`, botão Excluir, pixel (1312,528):
fundo `rgb(238,241,248)`, texto branco → **contraste 1,13:1** (base: 7,23:1). Idem Cancelar,
idem no celular (`juiz/linear_claro_torre_full.png`, 390px). O botão de apagar carga é
ilegível no tema claro. O `porque.md` afirma "tema claro e escuro ambos legíveis".
Tudo o mais nela está certo — e vai ser roubado (seção 5).

### Bloomberg — critério 2 (e identidade)
`.btn{ text-transform:uppercase; letter-spacing:.04em }`: "➕ Outra carga" vira "➕ OUTRA CAR…"
em todas as linhas da Torre — medido `scrollWidth 99 > clientWidth 96` com `ellipsis` em 6 botões
(`medidas_1440.json`, `bloomberg.escuro.torre.cortes.btn`); visível em `bloomberg/bloomberg_torre.png`.
A regra do briefing fala em corte "sem reticências"; eu não aceito botão de ação com rótulo
que não se lê, com ou sem reticências. Além disso: fundo `#050505`, âmbar `#ffb020`, fonte
monoespaçada no corpo inteiro — não é o painel azul-marinho e dourado. No celular claro
(`juiz/bloomberg_claro_torre_full.png`) os botões do cabeçalho ficam brancos sobre branco.

---

## 4. Sobreviventes — por que nenhum sobe como está

**Binance.** Faz o que o dono pediu: Indicadores 418px mais curta, Programação 254px, Torre 66px,
sem cortar nada; vidro vira superfície opaca; cabeçalho de coluna vira rótulo em caixa alta;
botões chapados; identidade preservada (`juiz/1440_binance_escuro_torre_full.png`).
Defeitos que impedem aprovação: (a) título de card a 11,5px em caixa alta — o nome da tela virou
letra miúda; (b) `.stat-num` em `ui-monospace` traz o zero cortado da DejaVu (o "0" de "Seguiu
Viagem hoje" parece "Ø") e uma segunda família tipográfica sem necessidade — `tabular-nums` já
resolve o alinhamento; (c) `th` a 10,5px com `letter-spacing .05em` faz "PROGRAMAÇÃO" (99px)
estourar a coluna de 92px; (d) `--vidro-sombra:0 0 0 0 rgba(0,0,0,0)` está certo (achado bom:
`none` numa lista de sombras invalida a lista), mas a camada some com TODA sombra e os cards
ficam sem separação no tema claro além da borda; (e) `.card-title .ico-card` a 14px encolhe o
ícone do título abaixo do texto.

**Meta.** Correta e cuidadosa (o único que documentou por que `border-color:transparent` e não
`border:0`). Mas o resultado é 95% a tela de hoje. Não é upgrade.

**Controle.** `#torre-tbody tr:has(.badge-aguardando-veiculo) > td{ box-shadow:inset 3px 0 0 ... }`
pinta a barra vermelha em CADA célula: no desktop vira uma grade de linhas vermelhas verticais
dentro da linha (`juiz/1440_controle_escuro_torre_full.png`, linha 1); no celular a barra
aparece no meio do cartão, ao lado de "VEÍCULO" (`juiz/controle_escuro_torre_full.png`).
`.stat-label` em caixa alta a 12px com `.05em` quebra "AGUARDANDO EMBARQUE" em duas linhas e
a faixa cresce 10px. A ideia (pulso na régua + linha acesa) é a única contribuição operacional
do campeonato e entra no híbrido, corrigida.

**Anthropic.** Tudo certo, nada novo. Serve de régua de contenção para botões.

**Vercel.** `--navy:#0a0a0a`, `--navy-deep:#000`. Não há Suinco nisto. `th` a 12px em caixa alta
com `.04em` faz "PROGRAMAÇÃO · ÚLTIMA ETAPA" ocupar três linhas e o cabeçalho crescer 12px.
Duas regras dela são boas e entram: o `:focus-visible` de 2,5px dourado e a régua sólida do header.

---

## 5. Decisão: campeão híbrido "Tema 2027"

Esqueleto: **Binance** (densidade, superfície opaca, rótulos de estrutura em caixa alta,
botão chapado). Roubos, com arquivo e seletor:

| Roubo | De onde | Por quê |
|------|---------|--------|
| Cor de estrutura ≠ cor de marca: `--border`, `--border-soft`, `--linha-fio` em azul-acinzentado; dourado só em ação/seleção/status; zebra com `--linha-fio` | `linear/camada.css` §1 e §4 | Hoje toda borda do escuro é dourada e o dourado não significa nada. É a melhor decisão do campeonato. |
| Sombra zerada NUNCA é `none` quando a variável entra numa lista | `binance/camada.css` cabeçalho, nota 3 | `.stat-ativo` usa `0 0 0 2px ... inset, var(--vidro-sombra)`; `none` mata o anel. |
| Aba ativa por preenchimento + a régua dourada à esquerda que já existe | `meta/camada.css` (`.nav-tab.active`) | Preenchimento lê melhor de longe; a régua continua por não depender só de cor. |
| Caixa filtrando (`.stat-ativo`) por preenchimento dourado a 16% MAIS o anel `inset` de 1,5px | `meta/camada.css` (`.stat-ativo`) | Estado visível a 3 metros; o anel fica porque o `styles.css` (linha ~5845) já registra que apagar o anel é apagar estado. |
| Régua de status a 4px e pulso de opacidade quando Aguardando Veículo > 0; linha da Torre acesa — só na PRIMEIRA célula | `controle/camada.css` §4, §5, §6 (corrigido) | O que exige ação é a única coisa que pode chamar o olho sozinha. |
| Botão chapado, hover só com `opacity`+`transform`, cores certificadas intocadas | `anthropic/camada.css` §5 | Volume por degradê é 2015; e o hover herdado do `styles.css` anima `box-shadow`/`filter`. |
| `:focus-visible` dourado de 2,5px, régua sólida do header | `vercel/camada.css` | Foco visível com luva no tablet; a régua-gradiente do header é "luz", o resto do tema é grade. |
| Quantidade alinhada à direita com `tabular-nums` NA TELA (fora da Torre) | `stripe/camada.css` §4 — reescrito dentro de `@media screen` | O PDF já faz; a tela não. Dígito bate com dígito. |
| `prefers-contrast: more` reforça borda | `apple/camada.css` §6 — sem o bloco `#nav` | Robustez de material sem custo. |

O que NÃO entra de ninguém: fonte monoespaçada (Binance, Bloomberg, Controle); qualquer
`background-image` sobre botão (Linear); `text-transform:uppercase` em `.btn` (Bloomberg);
`td > input` transparente (Stripe); grade de pontos/linhas no fundo (Controle, Vercel);
`.bento` puro reescrito (Suíço); `#nav{position:relative}` (Apple).

---

## 6. ESPECIFICAÇÃO DE TRABALHO — Tema 2027

### Regras para todo executor

- Painel EM PRODUÇÃO. Nenhum executor roda `publicar.sh`. Nenhum executor edita `index.html`.
- **Cada etapa escreve UM arquivo próprio** em
  `entregaveis/suinco_logistica/tema2027/NN_nome.css`. Ninguém escreve no arquivo de outra etapa.
  Ninguém edita `styles.css` (exceto Etapa 0, uma linha de comentário, se quiser apontar).
- **Todo bloco de nível superior de cada arquivo começa com `@media screen`** (`@media screen{...}`
  ou `@media screen and (...){...}`). `@keyframes` só DENTRO de um `@media screen`. Um arquivo com
  qualquer regra fora disso reprova no teste da Etapa 0 e a etapa não está pronta.
- Nunca redefinir: `--st-*` (as 21 variáveis de status), `--gold`, `--gold-dim`, `--gold-text`,
  `--text`, `--text-dim`, `--navy*`, `--wine*`, `--ok`, `--warn*`, `--header-h`, `--nav-h`, `--nav-w`,
  `--campo-bg`. Nunca tocar `.doc-*`, `.print-*`, `@media print`, `.bento` puro (sem `.bi-faixa`),
  `#torre-tabela` (larguras calibradas), `.mobile-cartao`, `.et-mini*` (as marcas ✓ ● · são texto).
- Movimento: só `transform` e `opacity`. Curva única `cubic-bezier(.22,.61,.36,1)`. Tudo que
  anima obedece `@media (prefers-reduced-motion: reduce)`.
- Sombra em variável que entra em lista: valor zerado é `0 0 0 0 rgba(0,0,0,0)`, nunca `none`.
- Cada etapa entrega: o arquivo CSS, o teste que REPROVA contra o `index.html` publicado e passa
  com o build novo, e a saída dos comandos de conferência colada no relato. "Deve funcionar" não existe.
- Relato com os três estados: ✅ no ar · 🟡 commitado, não publicado · ⬜ proposta.

### Ordem de execução

```
Etapa 0 (sequencial, sozinha) ─► Etapas 1,2,3,4,5,6 em PARALELO ─► Etapa 7 (sequencial)
```
Etapas 1–6 não colidem: cada uma é dona de um conjunto de seletores (listado em "Não toca").
Se um executor precisar de um seletor que é de outra etapa, ele NÃO escreve — anota no relato.

---

### Etapa 0 — Infraestrutura da camada (OBRIGATÓRIA, sequencial, 1 executor)

**Arquivos:** `entregaveis/suinco_logistica/build_arquivo_unico.py`,
`entregaveis/suinco_logistica/tema2027/` (nova pasta),
`entregaveis/suinco_logistica/testes/test_tema2027_so_tela.py` (novo),
`entregaveis/suinco_logistica/testes/test_tema2027_papel.py` (novo),
`entregaveis/suinco_logistica/testes/medir_tema2027.py` (novo, ferramenta).

1. Em `build_arquivo_unico.py`, logo depois de `css = ler('styles.css')` (linha 116): concatenar,
   em ordem alfabética de nome, todos os `tema2027/*.css`, separados por `\n`, ao FINAL de `css`.
   Resultado: um único `<style>` no `index.html`, com `styles.css` primeiro e a camada depois.
   (Não criar segundo `<style>`; não mudar o `re.subn` da linha 184.)
2. Criar `tema2027/00_tokens.css` … `60_acessibilidade.css` VAZIOS, cada um só com
   `@media screen{}` e um comentário de cabeçalho com o número da etapa, para as etapas 1–6
   preencherem sem criar arquivo.
3. `test_tema2027_so_tela.py`: para cada arquivo de `tema2027/`, remover comentários `/* */`,
   depois percorrer o texto de nível superior (fora de chaves) e reprovar se existir qualquer
   token que não seja `@media screen` (aceita `@media screen and (...)`). Reprova também `!important`
   fora de `@media (prefers-reduced-motion: reduce)`.
4. `test_tema2027_papel.py`: copiar a lógica de `camp/juiz_print_leak.py` (se o caminho não
   existir, reproduzir: trecho HTML com as classes acima, `page.emulate_media(media='print')`,
   `set_content` com `styles.css` puro vs `styles.css + tema2027/*.css`, `screenshot(full_page)`,
   `ImageChops.difference(...).getbbox()` tem de ser `None`). Rodar também com `styles.css +
   stripe/camada.css` como caso de controle: TEM de reprovar (prova que o teste enxerga vazamento).
5. `medir_tema2027.py`: copiar `camp/juiz_medidas.py` (ou reproduzir) adaptado para abrir
   `file:///.../index.html` com login local (`mostrarLoginLocal()`, `#login-nome`, `#login-setor`
   = Logística, `confirmarOperador()`), semear as 16 cargas (função `SEMEAR` do script), e gravar
   `medidas_<largura>_<rotulo>.json` com posições, cortes, contrastes e fontes das 4 abas × 2 temas.
   Rodar uma vez AGORA contra o `index.html` publicado e guardar como
   `testes/tema2027_referencia_1440.json` e `..._390.json` — é a base de comparação das etapas.
6. Rodar `python3 build_arquivo_unico.py` com os arquivos vazios e provar que o `index.html`
   resultante difere do anterior SÓ pelo carimbo de versão e pelos blocos `@media screen{}` vazios
   anexados ao fim do `<style>` (colar o `diff`).

**Conferir:** saída dos três testes verde; `diff` do `index.html` antes/depois só no carimbo;
`test_tema2027_papel.py` com a camada Stripe REPROVA (colar a saída).

---

### Etapa 1 — Tokens: cor de estrutura, raio, sombra, escala (OBRIGATÓRIA)

**Arquivo:** `tema2027/00_tokens.css`. **Dona de:** `:root`, `:root[data-tema="claro"]`, `body`, `body::before`.
**Não toca:** nenhum outro seletor.

```css
@media screen{
:root{
  /* superfície opaca: o vidro sai (custa GPU no tablet do pátio e não é 2027) */
  --vidro-bg:#1e2a52;
  --vidro-bg-forte:#2a3a6c;
  --vidro-borda:rgba(151,168,214,.22);
  --vidro-brilho:rgba(255,255,255,0);
  --vidro-sombra:0 1px 2px rgba(4,8,18,.45);
  --vidro-borrao:none;
  /* estrutura (grade, divisória, contorno) em azul-acinzentado — dourado vira significado */
  --border:rgba(151,168,214,.28);
  --border-soft:rgba(151,168,214,.14);
  --linha-fio:rgba(151,168,214,.09);
  --shadow:0 2px 8px rgba(4,8,18,.45);
  /* preenchimento de estado (hover / ativo), dourado da marca em véu */
  --acento-hover:rgba(233,185,84,.09);
  --acento-ativo:rgba(233,185,84,.16);
  /* geometria: canto vivo, não pílula */
  --radius:6px;
  --radius-sm:4px;
  --radius-lg:10px;
  /* ambiente quase mudo — presença de marca, não decoração */
  --amb-ouro:rgba(233,185,84,.05);
  --amb-azul:rgba(55,74,134,.10);
  --amb-vinho:rgba(143,31,38,.03);
  /* escala numérica um degrau abaixo (compactação) */
  --fs-numero:24px;
  --fs-numero-grande:30px;
  /* --sp-* NÃO mudam nesta rodada: gap de grade desloca campo de formulário no eixo x (chão 1) */
  --curva:cubic-bezier(.22,.61,.36,1);
}
:root[data-tema="claro"]{
  --vidro-bg:#eff3f9;
  --vidro-bg-forte:#f6f9fc;
  --vidro-borda:rgba(32,44,74,.16);
  --vidro-brilho:rgba(255,255,255,0);
  --vidro-sombra:0 1px 2px rgba(16,22,37,.10);
  --vidro-borrao:none;
  --border:rgba(32,44,74,.22);
  --border-soft:rgba(32,44,74,.11);
  --linha-fio:rgba(32,44,74,.065);
  --shadow:0 2px 8px rgba(16,22,37,.10);
  --acento-hover:rgba(26,32,45,.05);
  --acento-ativo:rgba(233,185,84,.20);
  --amb-ouro:rgba(233,185,84,.03);
  --amb-azul:rgba(55,74,134,.02);
  --amb-vinho:rgba(143,31,38,.015);
}
body{ line-height:1.35 }
body::before{ opacity:.5 }
}
```

**Conferir:** `test_vidro.py` verde (separação card/página ≥ 1,08 nos dois temas — escuro
#1e2a52 sobre #101625, claro #eff3f9 sobre #c6cfe0); `test_contraste.py` verde;
`getComputedStyle(document.querySelector('.card')).backgroundColor` = `rgb(30, 42, 82)` no escuro;
nenhum `backdrop-filter` diferente de `none` em `#header`/`#nav` (medir).

---

### Etapa 2 — Cascas: header, nav, card, modal (OBRIGATÓRIA)

**Arquivo:** `tema2027/10_cascas.css`. **Dona de:** `#header`, `#header::after`, `#logo-chip`,
`#nav`, `.nav-tab`, `.nav-tab.active`, `.nav-tab:hover`, `.card`, `.card::after`, `.card-title`,
`.card-title::before`, `.card-sub`, `.modal-box`, `.modal-overlay`, `.badge-setor`, `.funcao-aba`.
**Não toca:** `.stat-*`, `.bento*`, `table/th/td`, `.btn*`, `input/select/textarea`, `.badge`.

```css
@media screen{
#header{ background:var(--navy); box-shadow:none; border-bottom:1px solid var(--border);
  -webkit-backdrop-filter:none; backdrop-filter:none }
#header::after{ background:var(--gold) }               /* régua sólida de ponta a ponta */
#logo-chip{ border-radius:var(--radius-sm) }
.badge-setor{ border-radius:var(--radius-sm); padding:5px 12px }

#nav{ background:var(--navy); box-shadow:none; -webkit-backdrop-filter:none; backdrop-filter:none }
.nav-tab{ font-size:13.5px; font-weight:600; letter-spacing:.01em;
  transition:background-color var(--t-media) var(--curva), color var(--t-media) var(--curva) }
.nav-tab:hover{ background:var(--acento-hover) }
.nav-tab.active{ background:var(--acento-ativo); box-shadow:none; font-weight:700 }

.card{ background:var(--vidro-bg); border:1px solid var(--border-soft); border-radius:var(--radius);
  box-shadow:var(--vidro-sombra); padding:10px 14px; margin-bottom:8px }
.card::after{ display:none }                              /* fio de brilho do vidro */
.card-title{ font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:.06em;
  margin-bottom:8px; padding-left:10px }
.card-title::before{ background:var(--gold); width:3px; border-radius:0 }
.card-title .ico-card{ width:16px; height:16px }
.card-sub{ font-size:11.5px; margin-top:-4px; margin-bottom:6px; letter-spacing:.01em }
.funcao-aba{ border-color:var(--border-soft); border-left-color:var(--gold); padding:8px 12px }

.modal-overlay{ -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px) }  /* o único desfoque: apaga a tela de trás, é função */
.modal-box{ border-radius:var(--radius-lg); border:1px solid var(--border);
  box-shadow:0 2px 6px rgba(4,8,18,.35), 0 24px 48px -16px rgba(4,8,18,.6) }
}
@media screen and (min-width:821px){
  .nav-tab.active{ border-left-color:var(--gold) }   /* a régua fica: estado não depende só de cor */
}
```

**Não fazer:** `position` em `#nav` ou `#header` (Apple). `text-transform` em `.nav-tab`.
**Conferir:** `#header` e `#nav` com `position: fixed` (medir `getComputedStyle`); delta de
`#main.y` contra a referência = 0; `.card-title` não quebra em duas linhas em 1440 nas 4 abas;
no celular 390 o título quebra em no máximo 2 linhas como hoje; `guarda_do_padrao.py` verde.

---

### Etapa 3 — Indicadores (OBRIGATÓRIA)

**Arquivo:** `tema2027/20_indicadores.css`. **Dona de:** `.stat-box`, `.stat-box::before`,
`.stat-num`, `.stat-label`, `.stat-note`, `.stat-share`, `.stat-ativo`, `.stat-clicavel:hover`,
`.bento.bi-faixa` e descendentes, `.grafico-box`, `@keyframes t27-pulso`.
**Não toca:** `.bento` sem `.bi-faixa` (esteira de Devoluções), `grid-template-columns` de qualquer
`.bento` (a correção do buraco vem por cima), `#torre-tbody` (é da Etapa 4).

```css
@media screen{
.stat-box{ box-shadow:var(--vidro-sombra); border-radius:var(--radius); padding:10px 12px;
  transition:transform var(--t-media) var(--curva), border-color var(--t-media) var(--curva) }
.stat-box::before{ display:none }                          /* véu dourado do topo sai */
.stat-box:hover{ box-shadow:var(--vidro-sombra) }
.stat-num{ letter-spacing:-.02em; line-height:1.05 }
.stat-label{ font-size:11px; font-weight:700; letter-spacing:.02em }
.stat-note{ font-size:10px }
.stat-clicavel:hover{ background:var(--acento-hover) }
.stat-ativo{ background:var(--acento-ativo);
  box-shadow:0 0 0 1.5px var(--gold-text) inset, var(--vidro-sombra) }

.bento.bi-faixa{ border-color:var(--border); box-shadow:var(--vidro-sombra) }
.bento.bi-faixa .stat-box{ border-right-color:var(--linha-fio); border-bottom-color:var(--linha-fio);
  padding:8px 12px 8px 14px }
.bento.bi-faixa .stat-box::after{ width:4px }
.bento.bi-faixa .stat-num{ font-size:22px }
.bento.bi-faixa .stat-label{ font-size:10.5px; font-weight:700; letter-spacing:.02em; text-transform:uppercase }
.bento.bi-faixa .stat-destaque .stat-num{ font-size:30px }
.bento.bi-faixa .stat-destaque .stat-label{ font-size:11.5px }
.bento.bi-faixa .stat-ativo{ background:var(--acento-ativo); box-shadow:inset 0 0 0 1.5px var(--gold-text) }

.grafico-box{ border-color:var(--border-soft); box-shadow:var(--vidro-sombra); border-radius:var(--radius) }

/* urgência: a régua pulsa só onde há caminhão parado (n > 0) e só em opacidade */
@keyframes t27-pulso{ 0%,100%{ opacity:1 } 50%{ opacity:.35 } }
.bento.bi-faixa .stat-alerta:not(.stat-zerada)::after,
.bento.bi-faixa .stat-box[style*="--st-cor:var(--st-aguardando-veiculo-bg)"]:not(.stat-zerada)::after{
  animation:t27-pulso 2.4s ease-in-out infinite }
}
@media screen and (max-width:640px){
  .bento.bi-faixa .stat-label{ text-transform:none; letter-spacing:0 }   /* 3 colunas de ~120px: caixa alta não cabe */
}
@media screen and (prefers-reduced-motion: reduce){
  .bento.bi-faixa .stat-box::after{ animation:none !important }
}
```

**Conferir (obrigatório):** em 1440, escuro e claro, NENHUM `.stat-label` da faixa da Torre com
`scrollWidth > clientWidth` e nenhum com altura > 1 linha (`getClientRects().length === 1`) nas
seis caixas de status — se "AGUARDANDO EMBARQUE" quebrar, a ordem é reduzir `letter-spacing` para
`0`, e se ainda quebrar, tirar `text-transform` e relatar; a faixa da Torre não pode crescer mais
de 4px em altura contra a referência; `test_faixa_indicadores_bi.py` verde; o anel dourado da
caixa filtrando continua visível (clicar em "Aguardando Veículo" e medir `box-shadow` ≠ `none`);
`grep -n 'badge-aguardando-veiculo\|stat-zerada\|--st-cor:var(--st-aguardando-veiculo-bg)' app.js`
prova que os ganchos existem (colar as linhas).

---

### Etapa 4 — Tabelas (OBRIGATÓRIA; item 4c OPCIONAL)

**Arquivo:** `tema2027/30_tabelas.css`. **Dona de:** `table`, `th`, `td`, `tbody tr:nth-child(even)`,
`tr:hover td`, `#torre-tbody`, `.c-peso/.c-entregas/.c-ganchos/.num-forte`, `.table-wrap`.
**Não toca:** `#torre-tabela th`/`td` (padding calibrado, linha 5958 do `styles.css` vence por id —
não escrever nada com `#torre-tabela`), `td input`/`td select` (é da Etapa 5), `.mobile-cartao`.

```css
@media screen{
table{ font-size:13px }
th{ background:var(--vidro-bg-forte); color:var(--gold-text); padding:6px 8px;
  font-size:10.5px; font-weight:800; letter-spacing:.03em; text-transform:uppercase;
  border-bottom:1px solid var(--gold-dim) }
td{ padding:5px 8px; border-bottom:1px solid var(--linha-fio) }
tbody tr:nth-child(even){ background:var(--linha-fio) }
tr:hover td{ background:var(--acento-hover) }

/* 4b — a linha com caminhão parado no portão acende: fundo da linha + barra SÓ na primeira célula */
#torre-tbody tr:has(.badge-aguardando-veiculo) > td{ background:rgba(198,40,40,.10) }
#torre-tbody tr:has(.badge-aguardando-veiculo):hover > td{ background:rgba(198,40,40,.14) }
#torre-tbody tr:has(.badge-aguardando-veiculo) > td:first-child{
  box-shadow:inset 3px 0 0 var(--st-aguardando-veiculo-bg) }
}
@media screen and (min-width:821px){
  /* 4c OPCIONAL — quantidade alinhada à direita, como o PDF já faz. Nunca na Torre (inputs centrados por id). */
  td.c-peso, td.c-entregas, td.c-ganchos, td.num-forte, th.c-peso, th.c-entregas, th.c-ganchos{
    text-align:right; font-variant-numeric:tabular-nums }
}
@media screen and (max-width:820px){
  #torre-tbody tr:has(.badge-aguardando-veiculo) > td:first-child{ box-shadow:none }  /* no cartão do celular a barra some; fica o fundo */
}
```

**Conferir (obrigatório):** em 1440, `th` da Torre "Programação · Última etapa" com
`scrollWidth <= clientWidth` (o defeito de Binance/Vercel/Stripe: caixa alta que estoura 92px) —
se estourar, `letter-spacing:0` e relatar; nenhum `th` de nenhuma aba com mais linhas que na
referência; `x` e `width` de cada `th` da Torre e da Programação iguais à referência ±2px
(colunas não andam); a barra vermelha aparece UMA vez por linha (contar `td` com
`box-shadow` ≠ `none` na linha: tem de ser 1); no celular 390 nenhuma barra; `#main.height`
menor ou igual à referência em todas as abas (é compactação, não crescimento); `guarda_do_padrao.py`
verde (regra 4: `tabular-nums` nas colunas numéricas).

---

### Etapa 5 — Ações: botões, campos, selos (OBRIGATÓRIA)

**Arquivo:** `tema2027/40_acoes.css`. **Dona de:** `.btn*`, `input`, `select`, `textarea`,
`:focus-visible`, `.badge`, `.status-pill`, `.chip-*`, `.marca-multi`, `.legenda-chip`, `.dev-chip*`,
`.pill-count`, `#btn-menu`, `::-webkit-scrollbar*`.
**Não toca:** `.badge-setor` (Etapa 2), `.nav-tab` (Etapa 2), cor de fundo de qualquer badge de status.

```css
@media screen{
.btn{ border-radius:var(--radius-sm); box-shadow:none; font-size:13.5px; letter-spacing:0;
  transition:opacity var(--t-rapida) var(--curva), transform var(--t-rapida) var(--curva) }
.btn:hover{ filter:none; box-shadow:none; opacity:.88; transform:translateY(-1px) }
.btn:active{ transform:translateY(0) }
.btn-primary{ background:var(--gold); color:#1a1200 }
.btn-success{ background:#1d7a47; color:#fff }          /* 4,74:1 medido no styles.css — não reabrir */
.btn-danger{ background:var(--wine); color:#fff }
.btn-sec{ background:var(--navy-light); color:var(--text); border:1px solid var(--border) }
.btn-sec:hover{ background:var(--navy-lighter) }
.btn-sm{ font-size:12.5px }
#btn-menu{ border-radius:var(--radius-sm) }

input,select,textarea{ border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--campo-bg) }
input:focus,select:focus,textarea:focus{ border-color:var(--gold-dim) }
:focus-visible{ outline:2.5px solid var(--gold); outline-offset:1px }

.badge,.status-pill{ border-radius:3px; letter-spacing:.04em; padding:3px 9px }
.chip-dia-prog,.marca-multi,.legenda-chip,.dev-chip,.chip-no-patio,.chip-devolvida,.pill-count{ border-radius:3px }

::-webkit-scrollbar{ width:8px; height:8px }
::-webkit-scrollbar-thumb{ background:var(--border); border-radius:4px }
::-webkit-scrollbar-track{ background:transparent }
}
@media screen and (min-width:821px){
  .btn{ min-height:36px; padding:7px 14px }     /* no celular fica 40/44 — dedo com luva */
}
@media screen and (prefers-reduced-motion: reduce){
  .btn{ transition:none !important } .btn:hover,.btn:active{ transform:none !important }
}
```

**Não fazer:** `background-image` em `.btn` (Linear: 1,13:1); `text-transform` em `.btn`
(Bloomberg); borda/fundo transparente em `td input` (Stripe); trocar a cor certificada do
`.btn-success`.
**Conferir:** contraste texto/fundo de `.btn-danger`, `.btn-success`, `.btn-primary`, `.btn-sec`
≥ 4,5 nos dois temas medido por PIXEL (amostrar o fundo do botão no print, não só
`backgroundColor`); "Outra carga" e "Fechar Programação e Iniciar Nova" sem `scrollWidth >
clientWidth`; `input` da Torre com `borderColor` alfa > 0 nos dois temas; alvo de toque ≥ 44px no
390 (`guarda_do_padrao.py` regra 2); `Tab` pelo formulário de Programação mostra o anel dourado.

---

### Etapa 6 — Acessibilidade de material (OPCIONAL)

**Arquivo:** `tema2027/60_acessibilidade.css`. **Dona de:** só blocos `@media screen and (prefers-contrast: more)`.

```css
@media screen and (prefers-contrast: more){
  .card,.stat-box,.bento.bi-faixa{ border-width:1.5px; border-color:var(--border) }
  th{ border-bottom-width:2px }
  #nav{ border-right-width:2px }
}
```
**Conferir:** com `page.emulate_media(forced_colors=None)` e `prefers-contrast` não há API no
Playwright; conferir só que sem a preferência nada muda (diff de print = vazio).

---

### Etapa 7 — Integração e material de auditoria (OBRIGATÓRIA, sequencial, 1 executor)

1. `python3 build_arquivo_unico.py`.
2. Rodar, colando saída: `testes/test_tema2027_so_tela.py`, `testes/test_tema2027_papel.py`,
   `testes/test_contraste.py`, `testes/test_vidro.py`, `testes/guarda_do_padrao.py`,
   `testes/test_faixa_indicadores_bi.py`, `testes/medir_rolagem_com_dado.py`, e depois
   `bash testes/rodar_tudo.sh` (30 min — bateria inteira).
3. Rodar `medir_tema2027.py` em 1440 e 390 e gerar `tema2027_resultado_1440.json`/`_390.json`.
   Produzir `tema2027_delta.md`: para cada aba × tema, delta de x/width de `th` da Torre e
   Programação (tem de ser 0 ±2), delta de `#main.height` (tem de ser ≤ 0), lista de cortes
   (tem de ser vazia), contrastes < 4,5 (tem de ser vazia).
4. Gerar os prints da seção 8 e guardar em `entregaveis/suinco_logistica/tema2027/auditoria/`.
5. Relato com os três estados. Se QUALQUER teste ficar vermelho, descobrir qual das quatro causas
   (regra mudou de propósito / teste mede atalho / contaminação / regressão) antes de mexer —
   e escrever a causa no relato. Não "ajustar o teste até passar".

---

## 7. Decisões reservadas — NÃO decidam por mim, trago na rodada 2

- Família tipográfica (mono ou não, e onde). Ordem: **nenhuma `font-family` nova** nesta rodada.
- Ícones (tamanho, traço, cor na aba ativa). Não mexer em `.ico`, `.ico-card` além do `16px` da Etapa 2.
- Tela de login, modais de conteúdo, estados vazios (`.empty-state`, `.quick-box`), avisos
  (`.aviso-*`), esteira de Devoluções (`#dev-pipeline`), cartão do celular (`.mobile-cartao`),
  Histórico e Relatórios: **intocados** nesta rodada.
- Hover/transição além do especificado; qualquer animação nova além do pulso da Etapa 3.
- Tratamento do "buraco" da faixa: aplicado pelo coordenador por cima; ninguém toca
  `grid-template-columns`.
- Valores de `--fs-corpo`/`--fs-destaque`, os `--sp-*` (gap de grade) e a altura do header
  (`--header-h`): ficam. Densidade horizontal de formulário é rodada 2.
- Cor de fundo alternativa para o tema claro (o `#c6cfe0` da página é pesado, eu sei): rodada 2.

---

## 8. O QUE EU VOU CONFERIR NA AUDITORIA

Quero na minha frente, com estes nomes, em `tema2027/auditoria/`:

1. `ref_<aba>_<tema>_1440_full.png` e `t27_<aba>_<tema>_1440_full.png` — viewport 1440×900
   inteiro (header + nav + conteúdo), 4 abas (torre, programacao, indicadores, devolucoes) × 2 temas,
   ANTES (index.html publicado) e DEPOIS (build novo), mesma semente de 16 cargas, mesmo relógio
   congelado se possível. 16 imagens.
2. `t27_<aba>_<tema>_390_full.png` — celular, mesmas 4 abas × 2 temas. 8 imagens.
3. `t27_torre_escuro_1440_filtrando.png` — Torre com a caixa "Aguardando Veículo" clicada
   (anel + preenchimento visíveis) e a linha da carga 118800 acesa.
4. `t27_torre_escuro_1440_foco.png` — Tab até o campo Peso da primeira linha: anel de foco visível.
5. `t27_programacao_claro_1440_hover.png` — mouse sobre "Excluir": botão ainda legível.
6. `print_ref.png` e `print_t27.png` de `test_tema2027_papel.py` — e o `getbbox()` = `None`.
7. `tema2027_delta.md` (Etapa 7, item 3) e os dois JSON de medida.
8. Saída integral de `rodar_tudo.sh` (arquivo de log), com a lista de suítes vermelhas e a causa
   de cada uma classificada nas quatro causas.
9. `git diff --stat` da branch de trabalho: só `build_arquivo_unico.py`, `tema2027/`, `testes/` e
   o `index.html` gerado. Qualquer outro arquivo tocado é motivo para eu mandar refazer.

O que eu vou medir eu mesmo, por cima: contraste por pixel dos quatro botões nos dois temas;
`x`/`width` de cada coluna da Torre contra a referência; altura da faixa; se "AGUARDANDO
EMBARQUE" e "AGUARDANDO VEÍCULO" estão inteiros e distintos em 1440 e 390; se o PDF é idêntico;
e se alguém escreveu `font-family`, `position` ou `text-transform` onde eu disse que não.

---

## 9. Estado

⬜ Tudo neste documento é proposta. Nenhum arquivo em `/home/user/pega-visao` foi editado por mim.
⬜ Nenhum `camada.css` de competidor foi alterado.

---

## 10. RODADA 2 — auditoria de volta e decisões finais (17/09/2026)

Estado: 🟡 tudo abaixo está no working tree da branch de trabalho, medido
(`tema2027/auditoria/tema2027_delta.md`), não commitado, não publicado.

### O que eu escrevi na seção 6 e se provou errado contra o código real

1. **`th` em caixa alta.** Alargou "Programação · Última etapa" para 93px numa coluna
   de 92 (1440) e de 80 (1280), e "Ganchos"/"Entregas" da Montagem em 10–12px — colunas
   que já estavam com folga zero (o publicado corta 1–2px ali). E `text-transform`
   muda `innerText`: dois testes quebraram e `'Cliente' not in cabecalhos`
   (test_auditoria_refino.py) ficou cego. Rótulo de estrutura é cor + tamanho + peso.
   **Caixa alta no `th` sai. 11px, peso 700, cor dourada, fundo chapado, fio de 1px.**
2. **`.card-title` a 13px sem trava de largura.** No celular ele é o botão do acordeão,
   calibrado em 44px. **O bloco inteiro do título vai para `min-width:821px`.**
3. **`.btn{min-height:36px}` só por largura.** Tablet com toque caiu para 36px.
   **`and (pointer:fine)`.**
4. **`.nav-tab.active{box-shadow:none}`** — a minha própria regra da seção 5, violada no
   arquivo ao lado. E o zero (`0 0 0 0 rgba(0,0,0,0)`) mataria o toque do mesmo jeito,
   porque o problema é a ordem, não o valor. **`.nav-tab.active:not(:active){box-shadow:none}`.**
5. **`--acento-ativo` .16 no escuro** clareia o fundo da caixa ativa por padrão e derruba
   "▲ 10 vs. ontem" a 4,41. **.12** (4,84 medido).
6. **Linha acesa a .10/.14 no claro** escurece um fundo quase branco e, somada à zebra,
   derruba o tipo de veículo a 4,03. **Tokens por tema (`--t27-acesa` .10/.14 escuro,
   .07/.10 claro) e zebra cancelada na linha acesa.**
7. **`.stat-label{letter-spacing:.02em}`** genérico alcançava a faixa: "Aguardando
   Embarque" quebrava em duas linhas a 1440. **Sem letter-spacing.**

### Decisões reservadas (seção 7)

- **Fonte:** nenhuma `font-family` nova — decisão final, não só desta rodada. O painel
  roda offline (fila do `suinco-api.js`) e em máquina lenta (#37); fonte de rede é
  dependência e FOUT num painel vivo. `tabular-nums` já alinha.
- **Ícones:** `.ico-card` 16px só no computador; celular fica na base (15px). Aba ativa
  já pinta o ícone de dourado na base. Nada mais.
- **Fundo do tema claro:** `#c6cfe0` fica. A camada tirou a sombra do vidro; hoje é a
  diferença página/card que dá estrutura à tela clara (test_vidro ≥ 1,08). Clarear a
  página sem devolver sombra faz o card flutuar sem borda. Só se revisita com orçamento
  de sombra.
- **Densidade horizontal de formulário:** fica (`--sp-*` intocado, eixo x é chão 1).
- **Buraco da faixa:** fechado. `.bento.bi-faixa` vira `flex-wrap` a partir de 641px,
  base 134px por caixa e 268 no destaque: a primeira linha sai pixel-igual à grade
  (332/166px) e a última estica até a borda. `grid-template-columns` da base intocado;
  celular continua na grade de 3 colunas. Altura 182 → 175 (1440), 192 → 175 (1280).

### Guarda corrigida

`testes/guarda_do_padrao.py`: "fora da vista" passa a terminar onde o rodapé fixo
começa. A régua acusava um alvo de 340×61 porque três dos quatro pontos caíam
debaixo de `.rodape-conexao`. Publicado e novo: 18 falhas cada, o mesmo conjunto,
todas pré-existentes.

### O que fica ⬜ (proposta, fora desta rodada)

- `.sit-outras` 4,3 e "Caminhão NO PÁTIO" 1,39 no claro — herança da base, presente no
  publicado com os mesmos números.
- 18 falhas da guarda (Torre rola 144px no tablet; "?" de 13px; segmentos de 44px por
  0,x px) — todas do publicado.
- `test_tema2027_papel.py` grava no scratchpad de UMA sessão (caminho fixo) e
  `test_tema2027_etapa4_tabelas.py` reescreve um JSON versionado a cada rodada: os dois
  sujam ou dependem do ambiente. Uma linha cada.
